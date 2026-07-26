import type { RateComparison } from '@/types';

interface CacheEntry {
  key: string;
  expiresAt: number;
  value: RateComparison;
}

interface CacheState {
  entries: Map<string, CacheEntry>;
  anchorIndex: Map<string, Set<string>>;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
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
    if (entry.expiresAt <= now) {
      removeEntry(key);
    }
  }
}

export function getCachedRate(corridorId: string, amount: string): RateComparison | undefined {
  pruneExpired();
  const key = getEntryKey(corridorId, amount);
  const entry = cache.entries.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.entries.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCachedRate(corridorId: string, amount: string, value: RateComparison): void {
  pruneExpired();
  const key = getEntryKey(corridorId, amount);
  const entry = { key, expiresAt: Date.now() + DEFAULT_TTL_MS, value };
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
}

export function hasCachedRate(corridorId: string, amount: string): boolean {
  return getCachedRate(corridorId, amount) !== undefined;
}

export function listCachedRateKeys(): string[] {
  pruneExpired();
  return Array.from(cache.entries.keys());
}
