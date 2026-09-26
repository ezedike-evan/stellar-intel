import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getFxRate, getUsdFxRate, _clearFxCache } from '@/lib/fx/rates';

const MOCK_RATES = {
  NGN: 1600,
  EUR: 0.9,
  ARS: 1000,
};

describe('Cross-currency reference FX helper (#1281)', () => {
  beforeEach(() => {
    _clearFxCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _clearFxCache();
    vi.restoreAllMocks();
  });

  function stubFetch(rates: Record<string, number> = MOCK_RATES) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          result: 'success',
          rates,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
  }

  describe('identity rates (same currency)', () => {
    it('returns 1 immediately without making any fetch request for same currency', async () => {
      const fetchSpy = stubFetch();

      const rateARS = await getFxRate('ARS', 'ARS');
      expect(rateARS).toBe(1);

      const rateNGN = await getFxRate('NGN', 'NGN');
      expect(rateNGN).toBe(1);

      const rateUSD = await getFxRate('USD', 'USD');
      expect(rateUSD).toBe(1);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('handles case-insensitivity for same currency without fetch', async () => {
      const fetchSpy = stubFetch();

      const rate = await getFxRate('ars', 'ARS');
      expect(rate).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('direct USD rates', () => {
    it('returns direct rate when from is USD', async () => {
      stubFetch();

      const rate = await getFxRate('USD', 'NGN');
      expect(rate).toBe(1600);
    });

    it('handles lowercase usd code', async () => {
      stubFetch();

      const rate = await getFxRate('usd', 'eur');
      expect(rate).toBe(0.9);
    });
  });

  describe('cross-currency rates', () => {
    it('calculates cross rate via USD for EUR→NGN (1600 / 0.9 ≈ 1777.78)', async () => {
      stubFetch();

      const rate = await getFxRate('EUR', 'NGN');
      expect(rate).toBeCloseTo(1600 / 0.9, 2);
      expect(rate).toBeCloseTo(1777.78, 2);
    });

    it('calculates cross rate for ARS→NGN (1600 / 1000 = 1.6)', async () => {
      stubFetch();

      const rate = await getFxRate('ARS', 'NGN');
      expect(rate).toBe(1.6);
    });

    it('calculates inverse rate to USD (NGN→USD = 1 / 1600)', async () => {
      stubFetch();

      const rate = await getFxRate('NGN', 'USD');
      expect(rate).toBe(1 / 1600);
    });

    it('is case-insensitive for cross-rates', async () => {
      stubFetch();

      const rate = await getFxRate('eur', 'ngn');
      expect(rate).toBeCloseTo(1777.78, 2);
    });
  });

  describe('error handling', () => {
    it('throws when from currency is missing from the rate table', async () => {
      stubFetch();

      await expect(getFxRate('XYZ', 'NGN')).rejects.toThrow(
        'No reference FX rate available for XYZ→NGN'
      );
    });

    it('throws when to currency is missing from the rate table', async () => {
      stubFetch();

      await expect(getFxRate('EUR', 'XYZ')).rejects.toThrow(
        'No reference FX rate available for EUR→XYZ'
      );
    });

    it('preserves getUsdFxRate error message when from is USD and to is missing', async () => {
      stubFetch();

      await expect(getFxRate('USD', 'XYZ')).rejects.toThrow(
        'No reference FX rate available for USD→XYZ'
      );
    });

    it('preserves getUsdFxRate behaviour unchanged', async () => {
      stubFetch();

      const usdNgn = await getUsdFxRate('NGN');
      expect(usdNgn).toBe(1600);

      await expect(getUsdFxRate('XYZ')).rejects.toThrow(
        'No reference FX rate available for USD→XYZ'
      );
    });
  });
});
