// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/refunds/summary/route';
import { InMemoryRefundStore, _setRefundStore, type RefundCase } from '@/lib/refunds/store';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

const SIGNER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const HOUR_MS = 60 * 60 * 1000;

function refundCase(overrides: Partial<RefundCase> = {}): RefundCase {
  const openedAt = new Date(Date.now() - HOUR_MS).toISOString();
  return {
    id: crypto.randomUUID(),
    intentHash: 'a'.repeat(64),
    reason: 'anchor_refunded',
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    signerAccount: SIGNER,
    amountPaid: '100',
    status: 'refunded',
    amountRefunded: null,
    refundFee: null,
    payments: [],
    openedAt,
    refundedAt: openedAt,
    acknowledgedAt: null,
    ackHash: null,
    ackSignature: null,
    onChainCheck: null,
    ...overrides,
  };
}

const req = () =>
  new NextRequest('http://localhost:3000/api/v1/refunds/summary', {
    headers: { 'x-forwarded-for': '203.0.113.30' },
  });

describe('GET /api/v1/refunds/summary (#2121)', () => {
  let store: InMemoryRefundStore;

  beforeEach(() => {
    clearRateLimitStore();
    store = new InMemoryRefundStore();
    _setRefundStore(store);
  });

  afterEach(() => {
    _setRefundStore(null);
    clearRateLimitStore();
  });

  it('returns 200 with the metric keys, cacheable for 60s', async () => {
    await store.open(refundCase());
    await store.open(
      refundCase({
        intentHash: 'b'.repeat(64),
        openedAt: new Date(Date.now() - 100 * HOUR_MS).toISOString(),
        refundedAt: new Date(Date.now() - 100 * HOUR_MS).toISOString(),
      })
    );

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');

    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        'windowDays',
        'since',
        'generatedAt',
        'opened',
        'owed',
        'refunded',
        'acknowledged',
        'awaitingAck',
        'unsignaled',
        'overdueOwed',
        'gatePassing',
      ].sort()
    );
    expect(body).toMatchObject({
      windowDays: 30,
      opened: 2,
      refunded: 2,
      awaitingAck: 1,
      unsignaled: 1,
      gatePassing: false,
    });
  });

  it('contains no intent hash or signer account', async () => {
    await store.open(refundCase());

    const text = await (await GET(req())).text();
    expect(text).not.toContain('intentHash');
    expect(text).not.toContain('signerAccount');
    expect(text).not.toContain('a'.repeat(64));
    expect(text).not.toContain(SIGNER);
  });

  it('carries the v1 rate-limit headers', async () => {
    const res = await GET(req());
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
  });
});
