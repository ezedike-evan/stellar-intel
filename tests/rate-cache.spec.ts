import { describe, it, expect, beforeEach } from 'vitest';
import { clearRateCache, getCachedRate, invalidateCachedRates, setCachedRate } from '@/lib/api/rate-cache';

describe('rate cache', () => {
  beforeEach(() => {
    clearRateCache();
  });

  it('invalidates cached rates for a specific anchor', () => {
    setCachedRate('usdc-ngn', '100', {
      corridorId: 'usdc-ngn',
      rates: [{
        anchorId: 'moneygram',
        anchorName: 'MoneyGram',
        corridorId: 'usdc-ngn',
        fee: null,
        feeType: 'flat',
        exchangeRate: 1600,
        totalReceived: 160000,
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        source: 'sep38',
      }],
      pending: [],
      bestRateId: 'moneygram',
    });

    expect(getCachedRate('usdc-ngn', '100')).toBeDefined();

    invalidateCachedRates('moneygram');

    expect(getCachedRate('usdc-ngn', '100')).toBeUndefined();
  });

  it('invalidates all cached rates when requested', () => {
    setCachedRate('usdc-ngn', '100', {
      corridorId: 'usdc-ngn',
      rates: [],
      pending: [],
      bestRateId: '',
    });
    setCachedRate('usdc-kes', '100', {
      corridorId: 'usdc-kes',
      rates: [],
      pending: [],
      bestRateId: '',
    });

    invalidateCachedRates();

    expect(getCachedRate('usdc-ngn', '100')).toBeUndefined();
    expect(getCachedRate('usdc-kes', '100')).toBeUndefined();
  });
});
