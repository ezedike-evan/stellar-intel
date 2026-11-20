import { describe, it, expect, vi } from 'vitest';
import { USDC_ASSET } from '@/constants/anchors';
import { MAX_SPREAD_RATIO, referenceMidPrice } from '@/lib/fx/reference-mid';

const XLM = { code: 'XLM', issuer: null };

const book = (bids: number[], asks: number[]) => ({
  bids: bids.map((price) => ({ price, amount: 1_000 })),
  asks: asks.map((price) => ({ price, amount: 1_000 })),
});

describe('referenceMidPrice (Q38017)', () => {
  it('prices USDC as 1 USD through the FX rate, naming the source', async () => {
    const getUsdFxRate = vi.fn().mockResolvedValue(1600);
    const getOrderBook = vi.fn();

    const result = await referenceMidPrice(
      { code: USDC_ASSET.code, issuer: USDC_ASSET.issuer ?? null },
      'NGN',
      {
        getUsdFxRate,
        getOrderBook,
      }
    );

    expect(result).toEqual({
      price: 1600,
      source: 'fx',
      detail: 'USDC treated as 1 USD × open.er-api USD→NGN',
    });
    expect(getUsdFxRate).toHaveBeenCalledWith('NGN');
    expect(getOrderBook).not.toHaveBeenCalled();
  });

  it('prices a pegged asset through getFxRate(peg, fiat) without touching the order book', async () => {
    const getFxRate = vi.fn().mockResolvedValue(1);
    const getUsdFxRate = vi.fn();
    const getOrderBook = vi.fn();

    const result = await referenceMidPrice({ code: 'NGNC', issuer: 'GNGNC', peg: 'NGN' }, 'NGN', {
      getFxRate,
      getUsdFxRate,
      getOrderBook,
    });

    expect(result).toEqual({
      price: 1,
      source: 'fx',
      detail: 'NGNC pegged to NGN × open.er-api NGN→NGN',
    });
    expect(getFxRate).toHaveBeenCalledWith('NGN', 'NGN');
    expect(getUsdFxRate).not.toHaveBeenCalled();
    expect(getOrderBook).not.toHaveBeenCalled();
  });

  it('prices a pegged asset against a different fiat with the peg cross rate', async () => {
    const getFxRate = vi.fn().mockResolvedValue(0.00065);

    const result = await referenceMidPrice({ code: 'ARST', issuer: 'GARST', peg: 'ARS' }, 'USD', {
      getFxRate,
      getOrderBook: vi.fn(),
    });

    expect(result.price).toBe(0.00065);
    expect(result.source).toBe('fx');
    expect(getFxRate).toHaveBeenCalledWith('ARS', 'USD');
  });

  it('prices an unpegged asset off the SDEX mid against USDC, times FX', async () => {
    // bid 0.118, ask 0.122 → mid 0.12 USDC per XLM; × 1600 NGN per USD.
    const getUsdFxRate = vi.fn().mockResolvedValue(1600);
    const getOrderBook = vi.fn().mockResolvedValue(book([0.118, 0.1], [0.122, 0.2]));

    const result = await referenceMidPrice(XLM, 'NGN', { getUsdFxRate, getOrderBook });

    expect(result.source).toBe('sdex+fx');
    expect(result.price).toBeCloseTo(0.12 * 1600, 10);
    expect(result.detail).toBe('SDEX XLM/USDC mid 0.12 × open.er-api USD→NGN');
    expect(getOrderBook).toHaveBeenCalledWith('XLM', undefined, USDC_ASSET.code, USDC_ASSET.issuer);
  });

  it('throws when a side of the book is empty, and says which', async () => {
    const getUsdFxRate = vi.fn().mockResolvedValue(1);

    await expect(
      referenceMidPrice(XLM, 'USD', {
        getUsdFxRate,
        getOrderBook: vi.fn().mockResolvedValue(book([], [0.12])),
      })
    ).rejects.toThrow(/order book against USDC is empty on the bid side/);

    await expect(
      referenceMidPrice(XLM, 'USD', {
        getUsdFxRate,
        getOrderBook: vi.fn().mockResolvedValue(book([], [])),
      })
    ).rejects.toThrow(/empty on both sides/);
  });

  it('throws when the spread is wider than the 5% limit, naming both figures', async () => {
    // bid 0.10, ask 0.12 → spread ≈ 18.2% of the mid.
    const getUsdFxRate = vi.fn().mockResolvedValue(1);
    const getOrderBook = vi.fn().mockResolvedValue(book([0.1], [0.12]));

    await expect(referenceMidPrice(XLM, 'USD', { getUsdFxRate, getOrderBook })).rejects.toThrow(
      /spread is 18\.2%, wider than the 5% limit/
    );
    expect(MAX_SPREAD_RATIO).toBe(0.05);
  });

  it('accepts a spread at the limit', async () => {
    // bid 0.117, ask 0.123 → mid 0.12, spread exactly 5%.
    const getUsdFxRate = vi.fn().mockResolvedValue(2);
    const getOrderBook = vi.fn().mockResolvedValue(book([0.117], [0.123]));

    const result = await referenceMidPrice(XLM, 'EUR', { getUsdFxRate, getOrderBook });
    expect(result.price).toBeCloseTo(0.24, 10);
  });
});
