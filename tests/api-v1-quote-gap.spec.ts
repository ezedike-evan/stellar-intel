import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/v1/anchors/[id]/quote-gap/route';
import { ANCHORS } from '@/constants/anchors';
import { _setReputationStore, createReputationStore } from '@/lib/reputation/store';
import type { ReputationStore } from '@/lib/reputation/store';
import type { OutcomeLogRow } from '@/types/reputation';

vi.mock('@/lib/api/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 59,
    resetAt: Date.now() + 60_000,
    retryAfter: 0,
  }),
}));

const NOW = new Date('2026-10-25T12:00:00.000Z');
const anchor = ANCHORS[0]!;
const corridor = anchor.corridors[0]!;

let n = 0;
function outcome(gapPct: number, over: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  n += 1;
  return {
    intentHash: String(n).padStart(64, '0'),
    anchorId: anchor.id,
    corridor,
    direction: 'withdraw',
    quotedRate: '100',
    deliveredRate: String(100 + gapPct),
    quotedAmount: '100',
    deliveredAmount: '100',
    settleSeconds: 60,
    outcome: 'completed',
    createdAt: '2026-10-24T12:00:00.000Z',
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: 'GSIGNER',
    ...over,
  };
}

function call(query = '', id = anchor.id) {
  return GET(new Request(`http://localhost/api/v1/anchors/${id}/quote-gap${query}`) as never, {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/v1/anchors/[id]/quote-gap (#1500)', () => {
  let store: ReputationStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    store = createReputationStore({ backend: 'memory' });
    _setReputationStore(store);
  });

  afterEach(async () => {
    vi.useRealTimers();
    _setReputationStore(null);
    await store.close();
  });

  it('returns the stats with the basis, cacheable for five minutes', async () => {
    await store.append(outcome(-2));
    await store.append(outcome(-4));
    await store.append(outcome(3));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(body).toMatchObject({
      anchorId: anchor.id,
      basis: 'all-in rate: amount_out / amount_in vs rate shown before execution',
      sampleCount: 3,
      worseCount: 2,
      betterCount: 1,
      windowDays: 30,
    });
    expect(body.meanGapPct).toBeCloseTo(-1, 9);
    expect(body.p50GapPct).toBeCloseTo(-2, 9);
  });

  it('answers with nulls and a zero count when the anchor has no outcomes', async () => {
    const body = await (await call()).json();

    expect(body).toMatchObject({
      sampleCount: 0,
      meanGapPct: null,
      p50GapPct: null,
      p95AbsGapPct: null,
    });
  });

  it('applies the requested window', async () => {
    await store.append(outcome(-1, { createdAt: '2026-10-22T12:00:00.000Z' }));
    await store.append(outcome(-9, { createdAt: '2026-10-05T12:00:00.000Z' }));

    expect((await (await call('?window=7')).json()).sampleCount).toBe(1);
    expect((await (await call('?window=30')).json()).sampleCount).toBe(2);
    expect((await (await call('?window=90')).json()).windowDays).toBe(90);
  });

  it('counts only this anchor’s withdrawals', async () => {
    await store.append(outcome(-1));
    await store.append(outcome(-1, { direction: 'deposit' }));
    await store.append(
      outcome(-1, { anchorId: ANCHORS[1]!.id, corridor: ANCHORS[1]!.corridors[0]! })
    );

    expect((await (await call()).json()).sampleCount).toBe(1);
  });

  it('answers 404 for an unknown anchor', async () => {
    const res = await call('', 'no-such-anchor');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });

  it.each(['14', '0', 'abc', '-7', '30.5'])('answers 400 for window=%s', async (w) => {
    const res = await call(`?window=${w}`);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('validation_error');
  });

  it('answers 503 when the reputation store is unavailable', async () => {
    const broken = {
      ...store,
      query: async () => {
        throw new Error('db down');
      },
    } as unknown as ReputationStore;
    _setReputationStore(broken);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe('store_unavailable');
  });
});
