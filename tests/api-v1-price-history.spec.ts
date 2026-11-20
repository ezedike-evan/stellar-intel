import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, downsamplePoints } from '@/app/api/v1/anchors/[id]/price-history/route';
import { ANCHORS } from '@/constants/anchors';
import { _setReputationStore, createReputationStore } from '@/lib/reputation/store';
import type { ReputationStore } from '@/lib/reputation/store';
import type { QuoteHistoryRow } from '@/types/reputation';

vi.mock('@/lib/api/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 59,
    resetAt: Date.now() + 60_000,
    retryAfter: 0,
  }),
}));

const NOW = new Date('2026-10-20T12:00:00.000Z');
const anchor = ANCHORS.find((a) => a.corridors.length >= 2)!;
const [corridor, otherCorridor] = anchor.corridors as [string, string];

function quote(over: Partial<QuoteHistoryRow> = {}): QuoteHistoryRow {
  return {
    anchorId: anchor.id,
    corridor,
    sellAsset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    buyAsset: 'iso4217:NGN',
    sellAmount: '100',
    price: '1500',
    totalPrice: '150000',
    source: 'sep38-prices',
    observedAt: '2026-10-19T00:00:00.000Z',
    ...over,
  };
}

function call(path: string, id = anchor.id) {
  return GET(new Request(`http://localhost${path}`) as never, {
    params: Promise.resolve({ id }),
  });
}

describe('downsamplePoints', () => {
  it('keeps every point when under the cap', () => {
    expect(downsamplePoints([1, 2, 3], 500)).toEqual([1, 2, 3]);
  });

  it('caps the length and keeps the first and last points', () => {
    const points = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsamplePoints(points, 500);

    expect(out).toHaveLength(500);
    expect(out[0]).toBe(0);
    expect(out[499]).toBe(999);
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });
});

describe('GET /api/v1/anchors/[id]/price-history', () => {
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

  it('returns the recorded points for the first corridor by default', async () => {
    await store.recordQuote(quote({ observedAt: '2026-10-19T00:00:00.000Z', price: '1500' }));
    await store.recordQuote(quote({ observedAt: '2026-10-18T00:00:00.000Z', price: '1490' }));

    const res = await call(`/api/v1/anchors/${anchor.id}/price-history`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.anchorId).toBe(anchor.id);
    expect(body.corridor).toBe(corridor);
    expect(body.points).toEqual([
      {
        observedAt: '2026-10-18T00:00:00.000Z',
        price: '1490',
        totalPrice: '150000',
        source: 'sep38-prices',
      },
      {
        observedAt: '2026-10-19T00:00:00.000Z',
        price: '1500',
        totalPrice: '150000',
        source: 'sep38-prices',
      },
    ]);
  });

  it('only returns rows for the requested corridor', async () => {
    await store.recordQuote(quote({ corridor, price: '1500' }));
    await store.recordQuote(quote({ corridor: otherCorridor, price: '130' }));

    const res = await call(`/api/v1/anchors/${anchor.id}/price-history?corridor=${otherCorridor}`);
    const body = await res.json();

    expect(body.corridor).toBe(otherCorridor);
    expect(body.points.map((p: { price: string }) => p.price)).toEqual(['130']);
  });

  it('honours the days window', async () => {
    await store.recordQuote(quote({ observedAt: '2026-10-19T00:00:00.000Z' }));
    await store.recordQuote(quote({ observedAt: '2026-10-05T00:00:00.000Z' }));

    const week = await (await call(`/api/v1/anchors/${anchor.id}/price-history`)).json();
    const month = await (await call(`/api/v1/anchors/${anchor.id}/price-history?days=30`)).json();

    expect(week.points).toHaveLength(1);
    expect(month.points).toHaveLength(2);
  });

  it('downsamples to at most 500 points and keeps the first and last', async () => {
    for (let i = 0; i < 800; i++) {
      await store.recordQuote(
        quote({ observedAt: new Date(Date.UTC(2026, 9, 18) + i * 60_000).toISOString() })
      );
    }

    const body = await (await call(`/api/v1/anchors/${anchor.id}/price-history`)).json();

    expect(body.points).toHaveLength(500);
    expect(body.points[0].observedAt).toBe(new Date(Date.UTC(2026, 9, 18)).toISOString());
    expect(body.points[499].observedAt).toBe(
      new Date(Date.UTC(2026, 9, 18) + 799 * 60_000).toISOString()
    );
  });

  it('rejects a corridor the anchor does not serve with 400', async () => {
    const res = await call(`/api/v1/anchors/${anchor.id}/price-history?corridor=usdc-nowhere`);

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation_error');
  });

  it.each(['0', '91', '1.5', 'abc'])('rejects days=%s with 400', async (days) => {
    const res = await call(`/api/v1/anchors/${anchor.id}/price-history?days=${days}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown anchor', async () => {
    const res = await call('/api/v1/anchors/nope/price-history', 'nope');

    expect(res.status).toBe(404);
  });

  it('returns 503 when the store cannot be read', async () => {
    vi.spyOn(store, 'queryQuotes').mockRejectedValue(new Error('db down'));

    const res = await call(`/api/v1/anchors/${anchor.id}/price-history`);

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('store_unavailable');
  });
});
