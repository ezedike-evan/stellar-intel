import type { RateComparison } from '@/types';

interface CacheEntry {
  key: string;
  /** End of the fresh window: served directly, no revalidation. */
  freshUntil: number;
  /** End of the stale window: served immediately, revalidated in background. */
  staleUntil: number;
  value: RateComparison;
}

/**
 * How a lookup was satisfied, surfaced to callers (and as `X-Cache`).
 *
 * The distinction that matters is STALE vs MISS: a stale entry is returned to
 * the client *now* and refreshed behind the request, whereas a miss makes the
 * client wait on the upstream fan-out. The cache previously had no stale window
 * at all — an entry was fresh until it wasn't, and every expiry cost some
 * unlucky request a full multi-anchor fetch (#735).
 */
export type CacheStatus = 'HIT' | 'STALE' | 'MISS';

export interface CacheLookup {
  value: RateComparison | undefined;
  status: CacheStatus;
}

interface CacheState {
  entries: Map<string, CacheEntry>;
  anchorIndex: Map<string, Set<string>>;
}

/** Served directly within this window. */
export const FRESH_TTL_MS = 15 * 1000;
/**
 * Served stale-but-immediately within this window, with a background refresh.
 * Past it, a request must wait for live data — the issue's "never serve cached
 * data older than a hard max-age without at least attempting revalidation".
 */
export const STALE_TTL_MS = 10 * 60 * 1000;
const cache: CacheState = {
  entries: new Map<string, CacheEntry>(),
  anchorIndex: new Map<string, Set<string>>(),
};

function buildKey(corridorId: string, amount: string): string {
  return `${corridorId}:${amount}`;
}

function getEntryKey(corridorId: string, amount: string): string {
  return buildKey(corridorId, amount);
}

function removeEntry(key: string): void {
  cache.entries.delete(key);
  for (const [anchorId, keys] of Array.from(cache.anchorIndex.entries())) {
    keys.delete(key);
    if (keys.size === 0) {
      cache.anchorIndex.delete(anchorId);
    }
  }
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries.entries()) {
    if (entry.staleUntil <= now) {
      removeEntry(key);
    }
  }
}

/** Looks up an entry and reports whether it is fresh, stale, or absent. */
export function lookupCachedRate(corridorId: string, amount: string): CacheLookup {
  pruneExpired();
  const entry = cache.entries.get(getEntryKey(corridorId, amount));
  if (!entry) return { value: undefined, status: 'MISS' };

  const now = Date.now();
  if (now < entry.freshUntil) return { value: entry.value, status: 'HIT' };
  if (now < entry.staleUntil) return { value: entry.value, status: 'STALE' };

  removeEntry(entry.key);
  return { value: undefined, status: 'MISS' };
}

/** Fresh-only lookup, kept for callers that must not serve stale data. */
export function getCachedRate(corridorId: string, amount: string): RateComparison | undefined {
  const { value, status } = lookupCachedRate(corridorId, amount);
  return status === 'HIT' ? value : undefined;
}

export function setCachedRate(corridorId: string, amount: string, value: RateComparison): void {
  pruneExpired();
  const key = getEntryKey(corridorId, amount);
  const now = Date.now();
  const entry = {
    key,
    freshUntil: now + FRESH_TTL_MS,
    staleUntil: now + STALE_TTL_MS,
    value,
  };
  cache.entries.set(key, entry);

  for (const anchorId of value.rates.map((rate) => rate.anchorId)) {
    const keys = cache.anchorIndex.get(anchorId) ?? new Set<string>();
    keys.add(key);
    cache.anchorIndex.set(anchorId, keys);
  }
}

export function invalidateCachedRatesForAnchor(anchorId: string): void {
  pruneExpired();
  const keys = cache.anchorIndex.get(anchorId);
  if (!keys) return;

  for (const key of Array.from(keys)) {
    removeEntry(key);
  }
  cache.anchorIndex.delete(anchorId);
}

export function invalidateCachedRates(anchorId?: string): void {
  pruneExpired();
  if (anchorId) {
    invalidateCachedRatesForAnchor(anchorId);
    return;
  }

  cache.entries.clear();
  cache.anchorIndex.clear();
}

export function clearRateCache(): void {
  cache.entries.clear();
  cache.anchorIndex.clear();
  inFlight.clear();
}

export function hasCachedRate(corridorId: string, amount: string): boolean {
  return getCachedRate(corridorId, amount) !== undefined;
}

// ─── Single-flight revalidation ────────────────────────────────────────────────
//
// Without this, every request arriving during a stale window starts its own
// background refresh, so the moment an entry goes stale the upstream fan-out is
// hit once per concurrent request — a stampede precisely when the cache was
// meant to absorb load.

const inFlight = new Map<string, Promise<void>>();

/** Runs `refresh` for this key unless one is already running. Never rejects. */
export function reviveInBackground(
  corridorId: string,
  amount: string,
  refresh: () => Promise<void>
): void {
  const key = getEntryKey(corridorId, amount);
  if (inFlight.has(key)) return;

  const task = refresh()
    .catch(() => {
      // A failed revalidation leaves the stale entry in place. That is the
      // point of a stale window: upstream being down degrades freshness rather
      // than availability.
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, task);
}

/** Test seam: awaits any in-flight revalidations. */
export async function drainRevalidations(): Promise<void> {
  await Promise.all([...inFlight.values()]);
}

export function listCachedRateKeys(): string[] {
  pruneExpired();
  return Array.from(cache.entries.keys());
}
