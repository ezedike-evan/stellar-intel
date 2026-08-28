import { isAnchorDegraded } from '@/lib/stellar/anchors';
import { fetchCorridorRates } from '@/lib/stellar/server-rates';
import {
  invalidateCachedRates,
  lookupCachedRate,
  reviveInBackground,
  setCachedRate,
  type CacheStatus,
} from '@/lib/api/rate-cache';
import { recordRatesCacheHit, recordRatesCacheMiss } from '@/lib/metrics';
import type { RateComparison } from '@/types';

export interface ResolveCorridorRatesOptions {
  /** Bypasses the shared cache and re-fetches every anchor's live rate. */
  forceRefresh?: boolean;
}

export interface ResolveCorridorRatesResult {
  comparison: RateComparison;
  /** Whether this result came from the in-process cache or a live fetch. */
  servedFromCache: boolean;
  /** HIT (fresh), STALE (served now, refreshing behind the request), or MISS. */
  cacheStatus: CacheStatus;
}

/**
 * Fetches a corridor's rate comparison, going through the shared in-process
 * cache first. Cached results are ignored (and invalidated) once any of their
 * anchors is flagged degraded, so REST and GraphQL never serve a comparison
 * pinned to a since-disabled anchor.
 *
 * This is the single call site for "get rates for a corridor" — REST's
 * `GET /api/rates/[corridor]` and the GraphQL `rates` query both resolve
 * through here so the two surfaces can never drift on cache/degradation
 * semantics.
 */
export async function resolveCorridorRates(
  corridor: string,
  amount: string,
  options: ResolveCorridorRatesOptions = {}
): Promise<ResolveCorridorRatesResult> {
  const { forceRefresh = false } = options;

  const lookup = forceRefresh
    ? { value: undefined, status: 'MISS' as CacheStatus }
    : lookupCachedRate(corridor, amount);
  const cached = lookup.value;
  const hasHealthyCachedResult =
    cached !== undefined && !cached.rates.some((rate) => isAnchorDegraded(rate.anchorId));

  // Fresh — serve as-is.
  if (hasHealthyCachedResult && lookup.status === 'HIT') {
    recordRatesCacheHit();
    return { comparison: cached, servedFromCache: true, cacheStatus: 'HIT' };
  }

  // Stale but healthy — serve immediately and refresh behind the request, so
  // the cost of expiry is not paid by whichever request happens to arrive
  // first. Single-flighted, so a burst triggers one refresh, not one each.
  if (hasHealthyCachedResult && lookup.status === 'STALE') {
    recordRatesCacheHit();
    reviveInBackground(corridor, amount, async () => {
      const fresh = await fetchCorridorRates(corridor, amount);
      if (fresh.rates.length > 0) {
        setCachedRate(corridor, amount, fresh);
      }
    });
    return { comparison: cached, servedFromCache: true, cacheStatus: 'STALE' };
  }

  recordRatesCacheMiss();
  if (cached) {
    for (const rate of cached.rates) {
      if (isAnchorDegraded(rate.anchorId)) {
        invalidateCachedRates(rate.anchorId);
      }
    }
  }

  const comparison = await fetchCorridorRates(corridor, amount);
  if (comparison.rates.length > 0) {
    setCachedRate(corridor, amount, comparison);
  }

  return { comparison, servedFromCache: false, cacheStatus: 'MISS' };
}
