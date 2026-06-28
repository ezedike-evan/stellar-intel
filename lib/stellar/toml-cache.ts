import type { Sep1TomlData } from '@/types';

// In-memory TTL cache for resolved stellar.toml data, keyed by home domain.
// Mirrors lib/stellar/jwt-cache.ts (LRU + capacity), with a time-to-live so we
// don't re-fetch the same toml on every request (B042 / #475).

const DEFAULT_CAPACITY = 32;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // ~10 minutes

interface TomlCacheEntry {
  data: Sep1TomlData;
  expiresAt: number;
}

const cache = new Map<string, TomlCacheEntry>();
let capacity = DEFAULT_CAPACITY;
let ttlMs = DEFAULT_TTL_MS;

function evictIfOverCapacity(): void {
  while (cache.size > capacity) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Returns cached toml for the home domain, or undefined if absent/expired. */
export function getCachedToml(homeDomain: string): Sep1TomlData | undefined {
  const entry = cache.get(homeDomain);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(homeDomain);
    return undefined;
  }

  // Move to end → most-recently-used.
  cache.delete(homeDomain);
  cache.set(homeDomain, entry);
  return entry.data;
}

/** Caches toml for the home domain with the configured TTL. */
export function setCachedToml(homeDomain: string, data: Sep1TomlData): void {
  if (cache.has(homeDomain)) cache.delete(homeDomain);
  cache.set(homeDomain, { data, expiresAt: Date.now() + ttlMs });
  evictIfOverCapacity();
}

export function invalidateCachedToml(homeDomain: string): void {
  cache.delete(homeDomain);
}

export function clearTomlCache(): void {
  cache.clear();
}

export function setTomlCacheCapacity(n: number): void {
  capacity = Math.max(1, n);
  evictIfOverCapacity();
}

/** Overrides the TTL (ms). Exposed mainly for tests. */
export function setTomlCacheTtl(ms: number): void {
  ttlMs = Math.max(0, ms);
}

export const TOML_CACHE_TTL_MS = DEFAULT_TTL_MS;
