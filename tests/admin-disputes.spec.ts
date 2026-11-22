import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/disputes/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { _setDisputeStore, getDisputeStore } from '@/lib/reputation/disputes';
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

beforeEach(() => {
  clearRateLimitStore();
  _setDisputeStore(null);
  process.env.ADMIN_SECRET_KEY = ADMIN_KEY;
});

afterEach(() => {
  delete process.env.ADMIN_SECRET_KEY;
});

describe('POST /api/admin/disputes — validation and throttle (#1358)', () => {
  it('rejects an action outside accept|reject with 400', async () => {
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
    const dispute = {
      id: 'disp-1',
      intentHash: 'a'.repeat(64),
      publicKey: 'GBBD672BMD5JLN572A2DTK2G2D77RBPDG7O7X7634F7EQP4EV7XJ7K2X',
      anchorId: 'moneygram',
      reason: 'sensitive personal issue',
      status: 'open' as const,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
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
