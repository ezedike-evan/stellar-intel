import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as appendPOST } from '@/app/api/reputation/append/route';
import { GET as reconcileGET } from '@/app/api/reputation/reconcile/route';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';

let store: InMemoryReputationStore;

beforeEach(() => {
  store = new InMemoryReputationStore();
  _setReputationStore(store);
});

afterEach(() => {
  vi.restoreAllMocks();
  _setReputationStore(null);
});

function appendReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reputation/append', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validOutcome = {
  intentHash: 'intent-1',
  anchorId: 'cowrie',
  corridor: 'USDC-NGN',
  quotedRate: '1500.0',
  quotedAmount: '100',
  outcome: 'completed' as const,
  stellarTransactionId: 'stellar-tx-1',
};

describe('POST /api/reputation/append (#220)', () => {
  it('validates and writes exactly one row', async () => {
    const res = await appendPOST(appendReq(validOutcome));
    expect(res.status).toBe(201);
    expect(await store.query({})).toHaveLength(1);
  });

  it('rejects an invalid outcome (no write)', async () => {
    const res = await appendPOST(appendReq({ ...validOutcome, outcome: 'nope' }));
    expect(res.status).toBe(400);
    expect(await store.query({})).toHaveLength(0);
  });

  it('a terminal outcome produces exactly one row even if posted twice (idempotent)', async () => {
    await appendPOST(appendReq(validOutcome));
    await appendPOST(appendReq(validOutcome));
    expect(await store.query({ anchorId: 'cowrie' })).toHaveLength(1);
  });
});

describe('append -> reconcile end-to-end (#220 + #221 + #219)', () => {
  it('backfills the delivered amount from Horizon within the store', async () => {
    await appendPOST(appendReq(validOutcome));
    expect((await store.query({}))[0]?.deliveredAmount).toBeNull();

    // Stub Horizon: the settlement payment for stellar-tx-1.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ _embedded: { records: [{ type: 'payment', amount: '149000' }] } }),
      }))
    );

    const res = await reconcileGET(new NextRequest('http://localhost/api/reputation/reconcile'));
    const summary = await res.json();
    expect(summary.updated).toBe(1);

    const [row] = await store.query({ anchorId: 'cowrie' });
    expect(row?.deliveredAmount).toBe('149000');
    expect(row?.deliveredRate).toBe('1490.00000000'); // 149000 / 100
    expect(row?.reconciledAt).not.toBeNull();
    expect(await store.query({ pendingReconciliationOnly: true })).toHaveLength(0);
  });
});
