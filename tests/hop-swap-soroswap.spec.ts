import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSoroswapHop } from '@/lib/router/connectors/swap-soroswap';
import type { HopAsset, HopStep } from '@/types';

const USDC_CONTRACT = 'CBBHRKEP5M3NUDRISGLJKGHDHX3DA2CN2AZBQY6WLVUJ7VNLGSKBDUCM';
const XLM_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const USDC_INPUT: HopAsset = { asset: USDC_CONTRACT, amount: '1000000000' };

beforeEach(() => {
  process.env.SOROSWAP_API_KEY = 'sk_test_key';
  vi.restoreAllMocks();
});

afterEach(() => {
  delete process.env.SOROSWAP_API_KEY;
});

describe('createSoroswapHop', () => {
  it('plans a swap by calling POST /quote and reporting amountOut', async () => {
    let requestBody: Record<string, unknown> = {};
    let requestUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts: RequestInit) => {
        requestUrl = url;
        requestBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({ amountIn: '1000000000', amountOut: '10000000000' }),
        };
      })
    );

    const hop = createSoroswapHop({ assetOutContract: XLM_CONTRACT, account: 'GABC' });
    const result = await hop.plan(USDC_INPUT, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step.hopType).toBe('swap');
    expect(result.step.output).toEqual({ asset: XLM_CONTRACT, amount: '10000000000' });
    expect(requestUrl).toContain('/quote?network=mainnet');
    expect(requestBody['assetIn']).toBe(USDC_CONTRACT);
    expect(requestBody['assetOut']).toBe(XLM_CONTRACT);
    expect(requestBody['tradeType']).toBe('EXACT_IN');
  });

  it('rejects an input asset that is not a Soroban contract address', async () => {
    const hop = createSoroswapHop({ assetOutContract: XLM_CONTRACT, account: 'GABC' });
    const result = await hop.plan({ asset: 'iso4217:NGN', amount: '100' }, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unsupported_asset');
  });

  it('fails planning when SOROSWAP_API_KEY is not configured', async () => {
    delete process.env.SOROSWAP_API_KEY;
    const hop = createSoroswapHop({ assetOutContract: XLM_CONTRACT, account: 'GABC' });
    const result = await hop.plan(USDC_INPUT, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('config_error');
  });

  it('fails planning when the API returns a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({ message: 'insufficient liquidity' }),
      }))
    );

    const hop = createSoroswapHop({ assetOutContract: XLM_CONTRACT, account: 'GABC' });
    const result = await hop.plan(USDC_INPUT, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_route');
  });

  it('executes by calling POST /quote/build and returning the unsigned XDR', async () => {
    let buildBody: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: RequestInit) => {
        buildBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return { ok: true, json: async () => ({ xdr: 'AAAAAgAAAAA=' }) };
      })
    );

    const hop = createSoroswapHop({ assetOutContract: XLM_CONTRACT, account: 'GABC' });
    const step: HopStep = {
      hopType: 'swap',
      hopId: 'soroswap-swap',
      input: USDC_INPUT,
      output: { asset: XLM_CONTRACT, amount: '10000000000' },
      details: { quote: { amountIn: '1000000000', amountOut: '10000000000' } },
    };

    const result = await hop.execute(step, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.details).toEqual({ unsignedXdr: 'AAAAAgAAAAA=' });
    expect(buildBody['from']).toBe('GABC');
    expect(buildBody['to']).toBe('GABC');
  });

  it('fails execution when the step was not planned by this connector', async () => {
    const hop = createSoroswapHop({ assetOutContract: XLM_CONTRACT, account: 'GABC' });
    const step: HopStep = {
      hopType: 'swap',
      hopId: 'soroswap-swap',
      input: USDC_INPUT,
      output: { asset: XLM_CONTRACT, amount: '10000000000' },
      details: {}, // no quote
    };

    const result = await hop.execute(step, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('missing_planned_quote');
  });
});
