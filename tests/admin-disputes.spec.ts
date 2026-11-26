import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/disputes/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import {
  _setDisputeStore,
  InMemoryDisputeStore,
  getDisputeStore,
  type Dispute,
} from '@/lib/reputation/disputes';
import {
  _setAdjudicationLog,
  InMemoryAdjudicationLog,
  getAdjudicationLog,
  verifyChain,
} from '@/lib/reputation/adjudication-log';
import {
  _setReputationStore,
  InMemoryReputationStore,
  getReputationStore,
} from '@/lib/reputation/store';
import { toOutcomeLogRow } from '@/lib/reputation/schema';
import { _setWebhookEmitter } from '@/lib/webhooks/emit';

const ADMIN_KEY = 'test-admin-secret';

function post(body: unknown, key: string | null = ADMIN_KEY, ip = '203.0.113.60'): NextRequest {
  return new NextRequest('http://localhost/api/admin/disputes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
      ...(key ? { 'x-admin-key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}

function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'disp-1',
    intentHash: 'a'.repeat(64),
    publicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    anchorId: 'moneygram',
    reason: 'test reason',
    status: 'open',
    createdAt: '2026-10-01T10:00:00.000Z',
    resolvedAt: null,
    category: 'delayed',
    level: 'anchor',
    levelDeadline: '2026-10-04T10:00:00.000Z',
    subjectKind: 'outcome',
    subjectRef: 'a'.repeat(64),
    appealedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  clearRateLimitStore();
  _setDisputeStore(new InMemoryDisputeStore());
  _setAdjudicationLog(new InMemoryAdjudicationLog());
  _setReputationStore(new InMemoryReputationStore());
  process.env.ADMIN_SECRET_KEY = ADMIN_KEY;
});

afterEach(() => {
  _setDisputeStore(null);
  _setAdjudicationLog(null);
  _setReputationStore(null);
  delete process.env.ADMIN_SECRET_KEY;
});

describe('POST /api/admin/disputes — validation and throttle (#1358)', () => {
  it('rejects an action outside accept|reject|escalate with 400', async () => {
    const res = await POST(post({ id: 'x', action: 'maybe' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a missing, non-string or over-long id with 400', async () => {
    for (const id of [undefined, 42, '', 'x'.repeat(201)]) {
      const res = await POST(post({ id, action: 'accept' }));
      expect(res.status).toBe(400);
    }
  });

  it('rejects a body that is not an object with 400', async () => {
    expect((await POST(post(null))).status).toBe(400);
  });

  it('still answers 401 without the admin key, before any rate-limit bookkeeping', async () => {
    const res = await POST(post({ id: 'x', action: 'accept' }, null));
    expect(res.status).toBe(401);
  });

  it('answers 404 for a well-formed request about an unknown dispute', async () => {
    const res = await POST(post({ id: 'unknown', action: 'reject' }));
    expect(res.status).toBe(404);
  });

  it('rate-limits resolution: the 31st POST in a window is 429', async () => {
    let last = 0;
    for (let i = 0; i < 31; i += 1) {
      last = (await POST(post({ id: 'unknown', action: 'reject' }))).status;
    }
    expect(last).toBe(429);
  });
});

describe('POST /api/admin/disputes — lifecycle, logging and reputation flag (#2131)', () => {
  it('accept writes one accepted log entry and flags the outcome row disputed: true', async () => {
    const d = makeDispute({ id: 'disp-acc' });
    await getDisputeStore().create(d);

    // Seed outcome in reputation store
    await getReputationStore().append(
      toOutcomeLogRow({
        intentHash: d.intentHash,
        anchorId: d.anchorId,
        corridor: 'usdc-ngn',
        quotedRate: '1500.0',
        quotedAmount: '100',
        outcome: 'completed',
        stellarTransactionId: 'b'.repeat(64),
        publicKey: d.publicKey,
        signature: 'sig',
      })
    );

    const res = await POST(
      post({ id: 'disp-acc', action: 'accept', rationale: 'Valid user complaint' })
    );
    expect(res.status).toBe(200);

    // Verify dispute resolved
    const updated = await getDisputeStore().get('disp-acc');
    expect(updated?.status).toBe('accepted');

    // Verify log entry written
    const log = await getAdjudicationLog().list();
    expect(log.length).toBe(1);
    expect(log[0]?.action).toBe('accepted');
    expect(log[0]?.rationale).toBe('Valid user complaint');

    // Verify reputation outcome is flagged disputed
    const [outcome] = await getReputationStore().query({
      intentHash: d.intentHash,
      includeUnattested: true,
    });
    expect(outcome?.disputed).toBe(true);
    expect(outcome?.disputedReason).toContain('accepted');
  });

  it('reject writes rejected log entry and does not flag outcome', async () => {
    const d = makeDispute({ id: 'disp-rej' });
    await getDisputeStore().create(d);

    await getReputationStore().append(
      toOutcomeLogRow({
        intentHash: d.intentHash,
        anchorId: d.anchorId,
        corridor: 'usdc-ngn',
        quotedRate: '1500.0',
        quotedAmount: '100',
        outcome: 'completed',
        stellarTransactionId: 'b'.repeat(64),
        publicKey: d.publicKey,
        signature: 'sig',
      })
    );

    const res = await POST(post({ id: 'disp-rej', action: 'reject', rationale: 'User error' }));
    expect(res.status).toBe(200);

    const log = await getAdjudicationLog().list();
    expect(log.length).toBe(1);
    expect(log[0]?.action).toBe('rejected');

    const [outcome] = await getReputationStore().query({
      intentHash: d.intentHash,
      includeUnattested: true,
    });
    expect(outcome?.disputed).toBe(false);
  });

  it('escalate anchor -> review sets a new deadline and writes escalated log entry', async () => {
    const d = makeDispute({ id: 'disp-esc', level: 'anchor' });
    await getDisputeStore().create(d);

    const res = await POST(
      post({ id: 'disp-esc', action: 'escalate', rationale: 'Anchor did not reply' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level).toBe('review');

    const log = await getAdjudicationLog().list();
    expect(log.length).toBe(1);
    expect(log[0]?.action).toBe('escalated');
    expect(log[0]?.level).toBe('review');
  });

  it('rejects escalate at review with 409 CANNOT_ESCALATE', async () => {
    const d = makeDispute({ id: 'disp-review', level: 'review' });
    await getDisputeStore().create(d);

    const res = await POST(post({ id: 'disp-review', action: 'escalate' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CANNOT_ESCALATE');
  });

  it('rejects rationale containing a Stellar G-address with 400 RATIONALE_NOT_PUBLIC_SAFE', async () => {
    const d = makeDispute({ id: 'disp-safe' });
    await getDisputeStore().create(d);

    const res = await POST(
      post({
        id: 'disp-safe',
        action: 'accept',
        rationale: 'Paid to GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('RATIONALE_NOT_PUBLIC_SAFE');
  });

  it('rejects action on an already resolved dispute with 409 CONFLICT', async () => {
    const d = makeDispute({ id: 'disp-done', status: 'accepted' });
    await getDisputeStore().create(d);

    const res = await POST(post({ id: 'disp-done', action: 'reject' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CONFLICT');
  });

  it('verifies adjudication chain with verifyChain after a sequence of actions', async () => {
    const d = makeDispute({ id: 'disp-seq', level: 'anchor' });
    await getDisputeStore().create(d);

    await POST(post({ id: 'disp-seq', action: 'escalate', rationale: 'Step 1' }));
    await POST(post({ id: 'disp-seq', action: 'accept', rationale: 'Step 2' }));

    const log = await getAdjudicationLog().list();
    expect(log.length).toBe(2);

    const verification = verifyChain(log);
    expect(verification.ok).toBe(true);
    if (verification.ok) {
      expect(verification.length).toBe(2);
      expect(verification.head).toBe(log[1]?.entryHash);
    }
  });
});

describe('dispute.resolved webhooks (#2190)', () => {
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

  it('accept emits dispute.resolved with status accepted without publicKey or reason', async () => {
    const dispute = makeDispute({ reason: 'sensitive personal issue' });
    await getDisputeStore().create(dispute);

    const res = await POST(post({ id: dispute.id, action: 'accept' }));
    expect(res.status).toBe(200);
    expect(emitted).toHaveLength(1);
    const event = emitted[0]!;
    expect(event.kind).toBe('dispute.resolved');
    expect(event.payload).toMatchObject({
      disputeId: dispute.id,
      intentHash: dispute.intentHash,
      anchorId: 'moneygram',
      status: 'accepted',
    });
    expect(event.payload['resolvedAt']).toBeDefined();
    expect(event.payload).not.toHaveProperty('publicKey');
    expect(event.payload).not.toHaveProperty('reason');
  });

  it('an unknown id (404) emits nothing', async () => {
    const res = await POST(post({ id: 'unknown-disp', action: 'reject' }));
    expect(res.status).toBe(404);
    expect(emitted).toHaveLength(0);
  });

  it('an unauthorized request emits nothing', async () => {
    const res = await POST(post({ id: 'disp-1', action: 'accept' }, null));
    expect(res.status).toBe(401);
    expect(emitted).toHaveLength(0);
  });
});
