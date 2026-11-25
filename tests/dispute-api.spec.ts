// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { POST, GET, clearDisputeStores } from '@/app/api/reputation/dispute/route';
import { GET as ADMIN_GET, POST as ADMIN_POST } from '@/app/api/admin/disputes/route';
import { NextRequest } from 'next/server';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';
import { toOutcomeLogRow } from '@/lib/reputation/schema';
import { _setWebhookEmitter } from '@/lib/webhooks/emit';
import {
  getAdjudicationLog,
  _setAdjudicationLog,
  InMemoryAdjudicationLog,
  publicDisputeRef,
} from '@/lib/reputation/adjudication-log';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeIntentHash(): string {
  return 'a'.repeat(64); // valid 64-char hex
}

function hashFor(signer: Keypair): string {
  return Buffer.from(signer.rawPublicKey()).toString('hex');
}

function signHash(keypair: Keypair, intentHash: string): string {
  const messageBytes = Buffer.from(intentHash, 'hex');
  const sig = keypair.sign(messageBytes);
  return Buffer.from(sig).toString('base64');
}

function makeRequest(body: unknown, ip = '203.0.113.1'): NextRequest {
  return new NextRequest('http://localhost/api/reputation/dispute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

let reputation: InMemoryReputationStore;

async function seedOutcome(signer: Keypair, intentHash: string): Promise<void> {
  await reputation.append(
    toOutcomeLogRow({
      intentHash,
      anchorId: 'moneygram',
      corridor: 'usdc-ngn',
      quotedRate: '1500.0',
      quotedAmount: '100',
      outcome: 'completed',
      stellarTransactionId: 'a'.repeat(64),
      publicKey: signer.publicKey(),
      signature: 'unused-here',
    })
  );
}

beforeEach(() => {
  reputation = new InMemoryReputationStore();
  _setReputationStore(reputation);
  _setAdjudicationLog(new InMemoryAdjudicationLog());
});

afterEach(() => {
  _setReputationStore(null);
  _setAdjudicationLog(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/reputation/dispute', () => {
  let keypair: Keypair;
  const intentHash = makeIntentHash();

  beforeAll(() => {
    keypair = Keypair.random();
  });

  beforeEach(async () => {
    clearDisputeStores();
    await seedOutcome(keypair, intentHash);
  });

  it('returns 201 and sets disputed:true for a valid signed request with DSP002 fields', async () => {
    const signature = signHash(keypair, intentHash);
    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: keypair.publicKey(),
        signature,
        anchorId: 'moneygram',
        reason: 'transaction never settled',
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.disputed).toBe(true);
    expect(body.intentHash).toBe(intentHash);
    expect(body.anchorId).toBe('moneygram');
    expect(body.publicKey).toBe(keypair.publicKey());
    expect(body.level).toBe('anchor');
    expect(body.category).toBe('other');
    expect(body.ref).toBeDefined();

    // Check UUID format and ensure it does not leak public key prefix
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(body.id).not.toContain(keypair.publicKey().slice(0, 8));

    // Deadline is 72h after createdAt
    const createdTime = new Date(body.createdAt).getTime();
    const deadlineTime = new Date(body.levelDeadline).getTime();
    expect(deadlineTime - createdTime).toBe(72 * 3600 * 1000);
  });

  it('writes one filed adjudication log entry without public key or reason', async () => {
    const signature = signHash(keypair, intentHash);
    const reasonText = 'secret confidential reason text';
    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: keypair.publicKey(),
        signature,
        anchorId: 'moneygram',
        reason: reasonText,
        category: 'delayed',
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();

    const log = await getAdjudicationLog().list();
    expect(log.length).toBe(1);
    expect(log[0]?.action).toBe('filed');
    expect(log[0]?.disputeRef).toBe(body.ref);
    expect(log[0]?.category).toBe('delayed');
    expect(log[0]?.level).toBe('anchor');

    const logJson = JSON.stringify(log[0]);
    expect(logJson).not.toContain(keypair.publicKey());
    expect(logJson).not.toContain(reasonText);
  });

  it('rejects an unknown category with 422', async () => {
    const signature = signHash(keypair, intentHash);
    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: keypair.publicKey(),
        signature,
        anchorId: 'moneygram',
        reason: 'test',
        category: 'invalid_category',
      })
    );
    expect(res.status).toBe(422);
  });

  it('rejects a second dispute on the same intent while the first is open with 409', async () => {
    const signature = signHash(keypair, intentHash);
    const res1 = await POST(
      makeRequest({
        intentHash,
        publicKey: keypair.publicKey(),
        signature,
        anchorId: 'moneygram',
        reason: 'first dispute',
      })
    );
    expect(res1.status).toBe(201);

    const res2 = await POST(
      makeRequest({
        intentHash,
        publicKey: keypair.publicKey(),
        signature,
        anchorId: 'moneygram',
        reason: 'duplicate dispute',
      })
    );
    expect(res2.status).toBe(409);
    expect(await res2.json()).toMatchObject({
      code: 'CONFLICT',
      message: 'An open dispute already exists for this intent',
    });
  });

  it('returns 403 when signature is invalid', async () => {
    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: keypair.publicKey(),
        signature: Buffer.alloc(64).toString('base64'),
        anchorId: 'moneygram',
        reason: 'fraud',
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns 403 when signature belongs to a different keypair', async () => {
    const other = Keypair.random();
    const signature = signHash(other, intentHash);
    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: keypair.publicKey(),
        signature,
        anchorId: 'cowrie',
        reason: 'wrong rate',
      })
    );
    expect(res.status).toBe(403);
  });

  it('returns 422 when intentHash has wrong format', async () => {
    const res = await POST(
      makeRequest({
        intentHash: 'not-a-sha256',
        publicKey: keypair.publicKey(),
        signature: 'abc',
        anchorId: 'moneygram',
        reason: 'test',
      })
    );
    expect(res.status).toBe(422);
  });

  it('returns 400 for non-JSON body', async () => {
    const req = new NextRequest('http://localhost/api/reputation/dispute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('enforces 10-dispute-per-24h rate limit per publicKey across distinct intents', async () => {
    for (let i = 0; i < 10; i++) {
      const h = `00000000000000000000000000000000000000000000000000000000000000${String(i).padStart(2, '0')}`;
      await seedOutcome(keypair, h);
      const signature = signHash(keypair, h);
      const payload = {
        intentHash: h,
        publicKey: keypair.publicKey(),
        signature,
        anchorId: 'moneygram',
        reason: 'test',
      };
      const res = await POST(makeRequest(payload, `198.51.100.${i + 1}`));
      expect(res.status).toBe(201);
    }

    const h11 = `0000000000000000000000000000000000000000000000000000000000000011`;
    await seedOutcome(keypair, h11);
    const signature11 = signHash(keypair, h11);
    const payload11 = {
      intentHash: h11,
      publicKey: keypair.publicKey(),
      signature: signature11,
      anchorId: 'moneygram',
      reason: 'test',
    };
    const limited = await POST(makeRequest(payload11, '198.51.100.200'));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/reputation/dispute — only the attesting account may dispute (#1357)', () => {
  const intentHash = makeIntentHash();
  let signer: Keypair;

  beforeAll(() => {
    signer = Keypair.random();
  });

  beforeEach(async () => {
    clearDisputeStores();
    await seedOutcome(signer, intentHash);
  });

  function disputeBy(who: Keypair, hash = intentHash): NextRequest {
    return makeRequest({
      intentHash: hash,
      publicKey: who.publicKey(),
      signature: signHash(who, hash),
      anchorId: 'moneygram',
      reason: 'transaction never settled',
    });
  }

  it('lets the account that attested the outcome dispute it', async () => {
    expect((await POST(disputeBy(signer))).status).toBe(201);
  });

  it('refuses a different, validly signing key with 403', async () => {
    const stranger = Keypair.random();
    const res = await POST(disputeBy(stranger));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Only the account that attested the outcome can dispute it',
    });
  });

  it('answers 404 for an intent hash with no recorded outcome', async () => {
    const res = await POST(disputeBy(signer, 'b'.repeat(64)));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      code: 'NOT_FOUND',
      message: 'No outcome recorded for this intentHash',
    });
  });

  it('files nothing when the dispute is refused', async () => {
    await POST(disputeBy(Keypair.random()));
    process.env.ADMIN_SECRET_KEY = 'k';
    try {
      const list = await ADMIN_GET(
        new NextRequest('http://localhost/api/admin/disputes', {
          headers: { 'x-admin-key': 'k' },
        })
      );
      expect(await list.json()).toEqual([]);
    } finally {
      delete process.env.ADMIN_SECRET_KEY;
    }
  });
});

describe('disputes filed via the public route reach the admin queue (#1356)', () => {
  const ADMIN_KEY = 'test-admin-secret';

  function adminRequest(method: 'GET' | 'POST', body?: unknown): NextRequest {
    return new NextRequest('http://localhost/api/admin/disputes', {
      method,
      headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeEach(() => {
    clearDisputeStores();
    process.env.ADMIN_SECRET_KEY = ADMIN_KEY;
  });

  afterEach(() => {
    delete process.env.ADMIN_SECRET_KEY;
  });

  async function file(signer: Keypair): Promise<{ id: string }> {
    const intentHash = hashFor(signer);
    await seedOutcome(signer, intentHash);
    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: signer.publicKey(),
        signature: signHash(signer, intentHash),
        anchorId: 'moneygram',
        reason: 'transaction never settled',
      })
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string };
  }

  it('lists a filed dispute as open', async () => {
    const signer = Keypair.random();
    const { id } = await file(signer);

    const res = await ADMIN_GET(adminRequest('GET'));
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string; status: string; publicKey: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, status: 'open', publicKey: signer.publicKey() });
  });

  it('resolves a filed dispute through the admin route', async () => {
    const { id } = await file(Keypair.random());

    const res = await ADMIN_POST(adminRequest('POST', { id, action: 'accept' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: 'accepted' });

    const listed = (await (await ADMIN_GET(adminRequest('GET'))).json()) as Array<{
      status: string;
    }>;
    expect(listed[0]?.status).toBe('accepted');
  });

  it('answers 404 when resolving an id that was never filed', async () => {
    const res = await ADMIN_POST(adminRequest('POST', { id: 'nope', action: 'reject' }));
    expect(res.status).toBe(404);
  });
});

describe('dispute.opened webhooks (#2190)', () => {
  let emitted: Array<{ kind: string; payload: Record<string, unknown> }>;

  beforeEach(() => {
    emitted = [];
    _setWebhookEmitter((kind, payload) => {
      emitted.push({ kind, payload });
    });
  });

  afterEach(() => {
    _setWebhookEmitter(null);
  });

  it('emits dispute.opened on 201 without publicKey or reason', async () => {
    const signer = Keypair.random();
    const intentHash = hashFor(signer);
    await seedOutcome(signer, intentHash);

    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: signer.publicKey(),
        signature: signHash(signer, intentHash),
        anchorId: 'moneygram',
        reason: 'funds never arrived',
      })
    );
    expect(res.status).toBe(201);
    expect(emitted).toHaveLength(1);
    const event = emitted[0]!;
    expect(event.kind).toBe('dispute.opened');
    expect(event.payload).toMatchObject({
      intentHash,
      anchorId: 'moneygram',
    });
    expect(event.payload['disputeId']).toBeDefined();
    expect(event.payload['createdAt']).toBeDefined();
    expect(event.payload).not.toHaveProperty('publicKey');
    expect(event.payload).not.toHaveProperty('reason');
  });

  it('emits nothing on 403 signature failure', async () => {
    const signer = Keypair.random();
    const other = Keypair.random();
    const intentHash = hashFor(signer);
    await seedOutcome(signer, intentHash);

    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: signer.publicKey(),
        signature: signHash(other, intentHash),
        anchorId: 'moneygram',
        reason: 'fraud',
      })
    );
    expect(res.status).toBe(403);
    expect(emitted).toHaveLength(0);
  });

  it('emits nothing on 404 unknown outcome', async () => {
    const signer = Keypair.random();
    const intentHash = hashFor(signer);

    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: signer.publicKey(),
        signature: signHash(signer, intentHash),
        anchorId: 'moneygram',
        reason: 'not found',
      })
    );
    expect(res.status).toBe(404);
    expect(emitted).toHaveLength(0);
  });

  it('emits nothing on 422 validation failure', async () => {
    const res = await POST(
      makeRequest({
        intentHash: 'invalid-hash',
        publicKey: 'invalid-key',
        signature: 'invalid-sig',
        anchorId: 'invalid-anchor',
        reason: 'bad',
      })
    );
    expect(res.status).toBe(422);
    expect(emitted).toHaveLength(0);
  });
});

describe('GET /api/reputation/dispute — lookup by intentHash (#2136)', () => {
  const intentHash = makeIntentHash();
  let signer: Keypair;

  beforeAll(() => {
    signer = Keypair.random();
  });

  beforeEach(async () => {
    clearDisputeStores();
    await seedOutcome(signer, intentHash);
  });

  it('returns 422 for a malformed intentHash', async () => {
    const req = new NextRequest('http://localhost/api/reputation/dispute?intentHash=not-a-hash');
    const res = await GET(req);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns empty array when no dispute exists for intentHash', async () => {
    const req = new NextRequest(
      `http://localhost/api/reputation/dispute?intentHash=${'f'.repeat(64)}`
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disputes: [] });
  });

  it('returns one item with ref, without id, publicKey, reason, or subjectRef', async () => {
    const fileRes = await POST(
      makeRequest({
        intentHash,
        publicKey: signer.publicKey(),
        signature: signHash(signer, intentHash),
        anchorId: 'moneygram',
        reason: 'Super secret private reason',
        category: 'delayed',
      })
    );
    expect(fileRes.status).toBe(201);
    const filed = await fileRes.json();

    const req = new NextRequest(`http://localhost/api/reputation/dispute?intentHash=${intentHash}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disputes).toHaveLength(1);

    const dispute = body.disputes[0];
    expect(dispute.ref).toBe(publicDisputeRef(filed.id));
    expect(dispute.category).toBe('delayed');
    expect(dispute.level).toBe('anchor');
    expect(dispute.status).toBe('open');
    expect(dispute.createdAt).toBeDefined();

    // Verify sensitive/internal fields are NOT present in JSON
    expect(dispute.id).toBeUndefined();
    expect(dispute.publicKey).toBeUndefined();
    expect(dispute.reason).toBeUndefined();
    expect(dispute.subjectRef).toBeUndefined();

    const jsonStr = JSON.stringify(dispute);
    expect(jsonStr).not.toContain('Super secret private reason');
    expect(jsonStr).not.toContain(signer.publicKey());
    expect(jsonStr).not.toContain(filed.id);
  });
});
