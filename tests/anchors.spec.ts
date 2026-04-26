import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAllAnchorFees, AnchorRateError } from '@/lib/stellar/sep24';
import * as sep1 from '@/lib/stellar/sep1';
import type { AnchorRate } from '@/types';

const COWRIE_TRANSFER_SERVER = 'https://cowrie.exchange/sep24';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(sep1, 'getTransferServer').mockResolvedValue(COWRIE_TRANSFER_SERVER);
});

// ─── anchors.cowrie.exchangeRate-nonzero ──────────────────────────────────────

describe('anchors.cowrie.exchangeRate-nonzero', () => {
  it('populates a positive exchangeRate when the fee response includes a price field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fee: '2.00', price: '1580.50' }),
      }))
    );

    const results = await fetchAllAnchorFees('100', 'usdc-ngn');
    const cowrie = results.find(
      (r): r is PromiseFulfilledResult<AnchorRate> =>
        r.status === 'fulfilled' && r.value.anchorId === 'cowrie'
    );

    expect(cowrie).toBeDefined();
    expect(cowrie!.value.exchangeRate).toBeGreaterThan(0);
  });

  it('computes totalReceived as (amount − fee) × exchangeRate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fee: '2.00', price: '1580.00' }),
      }))
    );

    const results = await fetchAllAnchorFees('100', 'usdc-ngn');
    const cowrie = results.find(
      (r): r is PromiseFulfilledResult<AnchorRate> =>
        r.status === 'fulfilled' && r.value.anchorId === 'cowrie'
    );

    // (100 − 2) × 1580 = 154 840
    expect(cowrie!.value.totalReceived).toBeCloseTo(154_840, 0);
  });

  it('handles comma-formatted rates ("1,580.50") without returning 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fee: '2.00', price: '1,580.50' }),
      }))
    );

    const results = await fetchAllAnchorFees('100', 'usdc-ngn');
    const cowrie = results.find(
      (r): r is PromiseFulfilledResult<AnchorRate> =>
        r.status === 'fulfilled' && r.value.anchorId === 'cowrie'
    );

    expect(cowrie).toBeDefined();
    expect(cowrie!.value.exchangeRate).toBeCloseTo(1580.5, 1);
  });

  it('rejects with AnchorRateError when the fee response omits the exchange rate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fee: '2.00' }), // no price/exchange_rate field
      }))
    );

    const results = await fetchAllAnchorFees('100', 'usdc-ngn');
    const rateErrors = results.filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' && r.reason instanceof AnchorRateError
    );

    expect(rateErrors.length).toBeGreaterThan(0);
  });

  it('marks the AnchorRateError with the offending anchor id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fee: '2.00' }),
      }))
    );

    const results = await fetchAllAnchorFees('100', 'usdc-ngn');
    const cowrieError = results.find(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' &&
        r.reason instanceof AnchorRateError &&
        (r.reason as AnchorRateError).anchorId === 'cowrie'
    );

    expect(cowrieError).toBeDefined();
  });
});
