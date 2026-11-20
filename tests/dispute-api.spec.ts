// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { POST, clearDisputeStores } from '@/app/api/reputation/dispute/route';
import { GET as ADMIN_GET, POST as ADMIN_POST } from '@/app/api/admin/disputes/route';
import { NextRequest } from 'next/server';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';
import { toOutcomeLogRow } from '@/lib/reputation/schema';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeIntentHash(): string {
  return 'a'.repeat(64); // valid 64-char hex
}

/** A distinct, valid intent hash per signer, so several signers can each own an outcome. */
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

/**
 * Records an outcome attested by `signer`. Only that account may dispute it
 * (#1357), so every dispute that is expected to succeed needs one of these.
 */
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
});

afterEach(() => {
  _setReputationStore(null);
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

  it('returns 201 and sets disputed:true for a valid signed request', async () => {
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
  });

  it('returns 403 when signature is invalid', async () => {
    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: keypair.publicKey(),
        signature: Buffer.alloc(64).toString('base64'), // wrong signature
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
    const signature = signHash(other, intentHash); // signed by wrong key
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
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 when publicKey has wrong format', async () => {
    const res = await POST(
      makeRequest({
        intentHash,
        publicKey: 'not-a-stellar-key',
        signature: 'abc',
        anchorId: 'moneygram',
        reason: 'test',
      })
    );
    expect(res.status).toBe(422);
  });

  it('returns 422 when required fields are missing', async () => {
    const res = await POST(makeRequest({ intentHash, publicKey: keypair.publicKey() }));
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
    const body = await res.json();
    expect(body.code).toBe('INVALID_JSON');
  });

  it('enforces 10-dispute-per-24h rate limit per publicKey', async () => {
    const signature = signHash(keypair, intentHash);
    const payload = {
      intentHash,
      publicKey: keypair.publicKey(),
      signature,
      anchorId: 'moneygram',
      reason: 'test',
    };

    // A different IP each time, so it is the per-key quota that trips, not the per-IP one.
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest(payload, `198.51.100.${i + 1}`));
      expect(res.status).toBe(201);
    }

    const limited = await POST(makeRequest(payload, '198.51.100.200'));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('allows a different publicKey after the first key is rate-limited', async () => {
    const other = Keypair.random();
    const otherHash = hashFor(other);
    await seedOutcome(other, otherHash);

    const base1 = {
      intentHash,
      publicKey: keypair.publicKey(),
      signature: signHash(keypair, intentHash),
      anchorId: 'moneygram',
      reason: 'r',
    };
    const base2 = {
      intentHash: otherHash,
      publicKey: other.publicKey(),
      signature: signHash(other, otherHash),
      anchorId: 'moneygram',
      reason: 'r',
    };

    for (let i = 0; i < 10; i++) await POST(makeRequest(base1, `198.51.100.${i + 1}`));
    expect((await POST(makeRequest(base1, '198.51.100.200'))).status).toBe(429);
    expect((await POST(makeRequest(base2, '198.51.100.201'))).status).toBe(201);
  });
});

describe('POST /api/reputation/dispute — input bounds and per-IP limit (#1355)', () => {
  const intentHash = makeIntentHash();
  let keypair: Keypair;

  beforeAll(() => {
    keypair = Keypair.random();
  });

  beforeEach(async () => {
    clearDisputeStores();
    await seedOutcome(keypair, intentHash);
  });

  const payload = (overrides: Record<string, unknown> = {}) => ({
    intentHash,
    publicKey: keypair.publicKey(),
    signature: signHash(keypair, intentHash),
    anchorId: 'moneygram',
    reason: 'transaction never settled',
    ...overrides,
  });

  it('returns 422 for a reason over 1000 characters', async () => {
    const res = await POST(makeRequest(payload({ reason: 'x'.repeat(1001) })));
    expect(res.status).toBe(422);
  });

  it('accepts a reason of exactly 1000 characters', async () => {
    const res = await POST(makeRequest(payload({ reason: 'x'.repeat(1000) })));
    expect(res.status).toBe(201);
  });

  it('returns 422 for an anchorId that is not in the registry', async () => {
    const res = await POST(makeRequest(payload({ anchorId: 'not-an-anchor' })));
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe('Unknown anchorId');
  });

  it('returns 429 on the 11th request from one IP, even with a fresh key each time', async () => {
    for (let i = 0; i < 10; i += 1) {
      const fresh = Keypair.random();
      const freshHash = hashFor(fresh);
      await seedOutcome(fresh, freshHash);
      const res = await POST(
        makeRequest(
          {
            intentHash: freshHash,
            publicKey: fresh.publicKey(),
            signature: signHash(fresh, freshHash),
            anchorId: 'moneygram',
            reason: 'transaction never settled',
          },
          '192.0.2.77'
        )
      );
      expect(res.status).toBe(201);
    }

    const last = Keypair.random();
    const lastHash = hashFor(last);
    const res = await POST(
      makeRequest(
        {
          intentHash: lastHash,
          publicKey: last.publicKey(),
          signature: signHash(last, lastHash),
          anchorId: 'moneygram',
          reason: 'transaction never settled',
        },
        '192.0.2.77'
      )
    );
    expect(res.status).toBe(429);
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
