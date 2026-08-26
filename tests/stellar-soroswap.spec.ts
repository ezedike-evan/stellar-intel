/**
 * tests/stellar-soroswap.spec.ts
 *
 * Behaviour of lib/stellar/soroswap.ts when SOROSWAP_API_KEY is absent
 * (#1086). tests/hop-swap-soroswap.spec.ts already covers the connector
 * layer surfacing this as a `config_error` HopPlanResult; this file covers
 * the underlying client directly, asserting the actual decision: fail
 * loudly by throwing SoroswapConfigError naming the missing variable,
 * before any request reaches the network — not a silent skip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSoroswapQuote,
  buildSoroswapTransaction,
  SoroswapConfigError,
  type SoroswapQuote,
} from '@/lib/stellar/soroswap';

const ASSET_IN = 'CBBHRKEP5M3NUDRISGLJKGHDHX3DA2CN2AZBQY6WLVUJ7VNLGSKBDUCM';
const ASSET_OUT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

describe('lib/stellar/soroswap — behaviour when SOROSWAP_API_KEY is absent (#1086)', () => {
  const originalKey = process.env.SOROSWAP_API_KEY;

  beforeEach(() => {
    delete process.env.SOROSWAP_API_KEY;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SOROSWAP_API_KEY;
    else process.env.SOROSWAP_API_KEY = originalKey;
  });

  it('getSoroswapQuote fails loudly with a SoroswapConfigError naming SOROSWAP_API_KEY', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      getSoroswapQuote({ assetIn: ASSET_IN, assetOut: ASSET_OUT, amount: '1000000' })
    ).rejects.toBeInstanceOf(SoroswapConfigError);
    await expect(
      getSoroswapQuote({ assetIn: ASSET_IN, assetOut: ASSET_OUT, amount: '1000000' })
    ).rejects.toThrow(/SOROSWAP_API_KEY/);

    // Fails before any request is attempted — not a silent skip that would
    // otherwise show up as a confusing network or API error downstream.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('buildSoroswapTransaction fails loudly with a SoroswapConfigError naming SOROSWAP_API_KEY', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const quote: SoroswapQuote = { amountIn: '1000000', amountOut: '2000000' };

    await expect(
      buildSoroswapTransaction(quote, 'GABCDEXAMPLEACCOUNT')
    ).rejects.toBeInstanceOf(SoroswapConfigError);
    await expect(
      buildSoroswapTransaction(quote, 'GABCDEXAMPLEACCOUNT')
    ).rejects.toThrow(/SOROSWAP_API_KEY/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('succeeds and sends the key as a Bearer token once SOROSWAP_API_KEY is configured', async () => {
    process.env.SOROSWAP_API_KEY = 'sk_test_key';

    let authHeader: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: RequestInit) => {
        authHeader = (opts.headers as Record<string, string>)['Authorization'];
        return { ok: true, json: async () => ({ amountIn: '1000000', amountOut: '2000000' }) };
      })
    );

    const quote = await getSoroswapQuote({
      assetIn: ASSET_IN,
      assetOut: ASSET_OUT,
      amount: '1000000',
    });

    expect(quote.amountOut).toBe('2000000');
    expect(authHeader).toBe('Bearer sk_test_key');
  });
});
