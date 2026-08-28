import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RateComparison } from '@/types';

// #735 — stale-while-revalidate for the rates endpoint.
//
// The cache was previously fresh-until-expired: every expiry made some unlucky
// request wait on a multi-anchor fan-out. These tests pin the three states and,
// more importantly, that a stale hit does NOT block.

const comparison = (exchangeRate: number): RateComparison =>
  ({
    corridor: 'usdc-ngn',
    rates: [{ anchorId: 'test-anchor', anchorName: 'Test', exchangeRate }],
  }) as unknown as RateComparison;

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/stellar/server-rates', () => ({
  fetchCorridorRates: fetchMock,
}));

vi.mock('@/lib/stellar/anchors', () => ({
  isAnchorDegraded: () => false,
}));

describe('rate cache windows (#735)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const cache = await import('@/lib/api/rate-cache');
    cache.clearRateCache();
    fetchMock.mockReset().mockResolvedValue(comparison(1));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports HIT inside the fresh window without refetching', async () => {
    const { resolveCorridorRates } = await import('@/lib/api/rates-resolver');
    const { FRESH_TTL_MS } = await import('@/lib/api/rate-cache');

    const first = await resolveCorridorRates('usdc-ngn', '100');
    expect(first.cacheStatus).toBe('MISS');

    vi.advanceTimersByTime(FRESH_TTL_MS - 1);

    const second = await resolveCorridorRates('usdc-ngn', '100');
    expect(second.cacheStatus).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves STALE immediately and revalidates behind the request', async () => {
    const { resolveCorridorRates } = await import('@/lib/api/rates-resolver');
    const { FRESH_TTL_MS, drainRevalidations } = await import('@/lib/api/rate-cache');

    await resolveCorridorRates('usdc-ngn', '100');
    vi.advanceTimersByTime(FRESH_TTL_MS + 1);

    fetchMock.mockResolvedValue(comparison(2));
    const stale = await resolveCorridorRates('usdc-ngn', '100');

    // The caller got the old value without waiting — that is the whole point.
    expect(stale.cacheStatus).toBe('STALE');
    expect(stale.comparison.rates[0]?.exchangeRate).toBe(1);

    await drainRevalidations();

    const after = await resolveCorridorRates('usdc-ngn', '100');
    expect(after.cacheStatus).toBe('HIT');
    expect(after.comparison.rates[0]?.exchangeRate).toBe(2);
  });

  it('single-flights revalidation so a burst does not stampede', async () => {
    const { resolveCorridorRates } = await import('@/lib/api/rates-resolver');
    const { FRESH_TTL_MS, drainRevalidations } = await import('@/lib/api/rate-cache');

    await resolveCorridorRates('usdc-ngn', '100');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FRESH_TTL_MS + 1);

    await Promise.all([
      resolveCorridorRates('usdc-ngn', '100'),
      resolveCorridorRates('usdc-ngn', '100'),
      resolveCorridorRates('usdc-ngn', '100'),
    ]);
    await drainRevalidations();

    // One refresh for three concurrent stale hits, not three.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks and refetches past the stale window', async () => {
    const { resolveCorridorRates } = await import('@/lib/api/rates-resolver');
    const { STALE_TTL_MS } = await import('@/lib/api/rate-cache');

    await resolveCorridorRates('usdc-ngn', '100');
    vi.advanceTimersByTime(STALE_TTL_MS + 1);

    fetchMock.mockResolvedValue(comparison(3));
    const result = await resolveCorridorRates('usdc-ngn', '100');

    // Never serve data older than the hard max-age without revalidating.
    expect(result.cacheStatus).toBe('MISS');
    expect(result.comparison.rates[0]?.exchangeRate).toBe(3);
  });

  it('keeps the stale entry when revalidation fails', async () => {
    const { resolveCorridorRates } = await import('@/lib/api/rates-resolver');
    const { FRESH_TTL_MS, drainRevalidations } = await import('@/lib/api/rate-cache');

    await resolveCorridorRates('usdc-ngn', '100');
    vi.advanceTimersByTime(FRESH_TTL_MS + 1);

    fetchMock.mockRejectedValue(new Error('upstream down'));
    const stale = await resolveCorridorRates('usdc-ngn', '100');
    expect(stale.cacheStatus).toBe('STALE');

    await drainRevalidations();

    // Upstream being down degrades freshness, not availability.
    const again = await resolveCorridorRates('usdc-ngn', '100');
    expect(again.comparison.rates[0]?.exchangeRate).toBe(1);
  });

  it('keys the cache by corridor and amount', async () => {
    const { resolveCorridorRates } = await import('@/lib/api/rates-resolver');

    await resolveCorridorRates('usdc-ngn', '100');
    const other = await resolveCorridorRates('usdc-ngn', '500');

    // A different amount is a different quote, not a cache hit.
    expect(other.cacheStatus).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
