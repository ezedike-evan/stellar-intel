import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFxRate, getUsdFxRate, _clearFxCache } from '@/lib/fx/rates';

const MOCK_USD_RATES = {
  NGN: 1600,
  EUR: 0.9,
  ARS: 1000,
};

describe('getFxRate cross-currency reference FX helper', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    _clearFxCache();
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        result: 'success',
        rates: MOCK_USD_RATES,
      }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _clearFxCache();
  });

  it('returns 1 for same-currency without calling fetch', async () => {
    const rateARS = await getFxRate('ARS', 'ARS');
    expect(rateARS).toBe(1);

    const rateEUR = await getFxRate('eur', 'EUR');
    expect(rateEUR).toBe(1);

    const rateUSD = await getFxRate('usd', 'usd');
    expect(rateUSD).toBe(1);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns direct USD rate when from is USD', async () => {
    const rate = await getFxRate('USD', 'NGN');
    expect(rate).toBe(1600);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const rateLower = await getFxRate('usd', 'ars');
    expect(rateLower).toBe(1000);
  });

  it('calculates cross rate via USD for non-USD pairs', async () => {
    const rateEurNgn = await getFxRate('EUR', 'NGN');
    expect(rateEurNgn).toBeCloseTo(1600 / 0.9, 2); // ≈ 1777.78

    const rateArsEur = await getFxRate('ARS', 'EUR');
    expect(rateArsEur).toBeCloseTo(0.9 / 1000, 4); // 0.0009
  });

  it('throws an informative error when a currency is missing or unquoted', async () => {
    await expect(getFxRate('EUR', 'UNKNOWN')).rejects.toThrow(
      'No reference FX rate available for EUR→UNKNOWN',
    );

    await expect(getFxRate('UNKNOWN', 'NGN')).rejects.toThrow(
      'No reference FX rate available for UNKNOWN→NGN',
    );
  });

  it('preserves getUsdFxRate behaviour', async () => {
    const rate = await getUsdFxRate('NGN');
    expect(rate).toBe(1600);

    await expect(getUsdFxRate('MISSING')).rejects.toThrow(
      'No reference FX rate available for USD→MISSING',
    );
  });
});
