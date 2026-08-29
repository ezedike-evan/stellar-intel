import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import type { Sep1TomlData } from '@/types';
import {
  getCachedToml,
  setCachedToml,
  invalidateCachedToml,
  clearTomlCache,
  setTomlCacheCapacity,
  setTomlCacheTtl,
  TOML_CACHE_TTL_MS,
} from '@/lib/stellar/toml-cache';

function tomlFor(domain: string): Sep1TomlData {
  return {
    domain,
    TRANSFER_SERVER_SEP0024: `https://${domain}/sep24`,
    WEB_AUTH_ENDPOINT: `https://${domain}/auth`,
    SIGNING_KEY: 'GABC',
    NETWORK_PASSPHRASE: Networks.PUBLIC,
    ORG_URL: null,
    ORG_SUPPORT_EMAIL: null,
    ORG_SUPPORT_URL: null,
    CURRENCIES: [],
  } as unknown as Sep1TomlData;
}

beforeEach(() => {
  clearTomlCache();
  setTomlCacheCapacity(32);
  setTomlCacheTtl(TOML_CACHE_TTL_MS);
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toml-cache', () => {
  it('returns undefined on a miss and the data on a hit', () => {
    expect(getCachedToml('a.com')).toBeUndefined();
    setCachedToml('a.com', tomlFor('a.com'));
    expect(getCachedToml('a.com')?.domain).toBe('a.com');
  });

  it('expires entries after the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    setCachedToml('a.com', tomlFor('a.com'));

    vi.setSystemTime(new Date(Date.now() + TOML_CACHE_TTL_MS - 1));
    expect(getCachedToml('a.com')).toBeDefined();

    vi.setSystemTime(new Date(Date.now() + 2));
    expect(getCachedToml('a.com')).toBeUndefined();
  });

  it('invalidate and clear remove entries', () => {
    setCachedToml('a.com', tomlFor('a.com'));
    setCachedToml('b.com', tomlFor('b.com'));
    invalidateCachedToml('a.com');
    expect(getCachedToml('a.com')).toBeUndefined();
    expect(getCachedToml('b.com')).toBeDefined();
    clearTomlCache();
    expect(getCachedToml('b.com')).toBeUndefined();
  });

  it('evicts the oldest entry when over capacity (LRU)', () => {
    setTomlCacheTtl(60_000);
    setTomlCacheCapacity(2);
    setCachedToml('a.com', tomlFor('a.com'));
    setCachedToml('b.com', tomlFor('b.com'));
    // Touch a.com so b.com becomes the least-recently-used.
    getCachedToml('a.com');
    setCachedToml('c.com', tomlFor('c.com')); // evicts b.com

    expect(getCachedToml('a.com')).toBeDefined();
    expect(getCachedToml('c.com')).toBeDefined();
    expect(getCachedToml('b.com')).toBeUndefined();
  });
});
