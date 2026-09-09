import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSoroswapQuote,
  buildSoroswapTransaction,
  soroswapConfig,
  SoroswapApiError,
  SoroswapConfigError,
} from '@/lib/stellar/soroswap';
import { createSoroswapHop } from '@/lib/router/connectors/swap-soroswap';
import type { HopAsset, HopStep } from '@/types';
import {
  USDC_CONTRACT,
  XLM_CONTRACT,
  MOCK_QUOTE_RESPONSE,
  MOCK_BUILD_RESPONSE,
  MOCK_ERROR_RESPONSES,
} from './fixtures/soroswap-retry';

const USDC_INPUT: HopAsset = { asset: USDC_CONTRACT, amount: '1000000000' };

describe('Soroswap timeout and retry paths (#1085)', () => {
  beforeEach(() => {
    process.env.SOROSWAP_API_KEY = 'sk_test_key';
    soroswapConfig.timeoutMs = 100;
    soroswapConfig.retryAttempts = 2;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.SOROSWAP_API_KEY;
    soroswapConfig.timeoutMs = 8000;
    soroswapConfig.retryAttempts = 2;
  });

  describe('Timeout behavior', () => {
    it('times out and retries when the endpoint exceeds timeoutMs', async () => {
      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, opts?: RequestInit) => {
          callCount++;
          return new Promise((resolve, reject) => {
            if (opts?.signal?.aborted) {
              return reject(new DOMException('The operation was aborted', 'AbortError'));
            }
            opts?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          });
        })
      );

      await expect(
        getSoroswapQuote({
          assetIn: USDC_CONTRACT,
          assetOut: XLM_CONTRACT,
          amount: '1000000000',
        })
      ).rejects.toThrow(/timed out|aborted/i);

      // Initial attempt (1) + 2 retries = 3 total attempts
      expect(callCount).toBe(3);
    });

    it('fails planning in connector with quote_failed on timeout', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, opts?: RequestInit) => {
          return new Promise((resolve, reject) => {
            if (opts?.signal?.aborted) {
              return reject(new DOMException('The operation was aborted', 'AbortError'));
            }
            opts?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          });
        })
      );

      const hop = createSoroswapHop({ assetOutContract: XLM_CONTRACT, account: 'GABC' });
      const result = await hop.plan(USDC_INPUT, {});

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('quote_failed');
      expect(result.details).toMatch(/timed out|aborted/i);
    });
  });

  describe('Transient failures & retry-then-succeed', () => {
    it('recovers and returns quote when first attempt fails with 503 Service Unavailable', async () => {
      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              ok: false,
              status: MOCK_ERROR_RESPONSES.serviceUnavailable503.status,
              json: async () => MOCK_ERROR_RESPONSES.serviceUnavailable503.body,
            };
          }
          return { ok: true, json: async () => MOCK_QUOTE_RESPONSE };
        })
      );

      const quote = await getSoroswapQuote({
        assetIn: USDC_CONTRACT,
        assetOut: XLM_CONTRACT,
        amount: '1000000000',
      });

      expect(quote.amountOut).toBe(MOCK_QUOTE_RESPONSE.amountOut);
      expect(callCount).toBe(2);
    });

    it('recovers on build transaction after initial network fetch failure', async () => {
      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('fetch failed: ECONNRESET');
          }
          return { ok: true, json: async () => MOCK_BUILD_RESPONSE };
        })
      );

      const buildResult = await buildSoroswapTransaction(
        MOCK_QUOTE_RESPONSE,
        'GABC',
        'GABC',
        'mainnet'
      );

      expect(buildResult.xdr).toBe(MOCK_BUILD_RESPONSE.xdr);
      expect(callCount).toBe(2);
    });
  });

  describe('Retry-exhausted path', () => {
    it('throws SoroswapApiError after exhausting all retryAttempts on 500 errors', async () => {
      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          callCount++;
          return {
            ok: false,
            status: MOCK_ERROR_RESPONSES.internalServerError500.status,
            json: async () => MOCK_ERROR_RESPONSES.internalServerError500.body,
          };
        })
      );

      await expect(
        getSoroswapQuote({
          assetIn: USDC_CONTRACT,
          assetOut: XLM_CONTRACT,
          amount: '1000000000',
        })
      ).rejects.toBeInstanceOf(SoroswapApiError);

      expect(callCount).toBe(3); // 1 initial + 2 retries
    });
  });

  describe('Deterministic non-retry path', () => {
    it('does not retry deterministic 422 Unprocessable Entity and fails immediately', async () => {
      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          callCount++;
          return {
            ok: false,
            status: MOCK_ERROR_RESPONSES.unprocessableEntity422.status,
            json: async () => MOCK_ERROR_RESPONSES.unprocessableEntity422.body,
          };
        })
      );

      await expect(
        getSoroswapQuote({
          assetIn: USDC_CONTRACT,
          assetOut: XLM_CONTRACT,
          amount: '1000000000',
        })
      ).rejects.toBeInstanceOf(SoroswapApiError);

      expect(callCount).toBe(1); // exactly 1 call, no retries
    });

    it('does not retry deterministic 400 Bad Request', async () => {
      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          callCount++;
          return {
            ok: false,
            status: MOCK_ERROR_RESPONSES.badRequest400.status,
            json: async () => MOCK_ERROR_RESPONSES.badRequest400.body,
          };
        })
      );

      await expect(
        buildSoroswapTransaction(MOCK_QUOTE_RESPONSE, 'GABC', 'GABC', 'mainnet')
      ).rejects.toBeInstanceOf(SoroswapApiError);

      expect(callCount).toBe(1); // exactly 1 call, no retries
    });

    it('does not retry when SOROSWAP_API_KEY is missing', async () => {
      delete process.env.SOROSWAP_API_KEY;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        getSoroswapQuote({
          assetIn: USDC_CONTRACT,
          assetOut: XLM_CONTRACT,
          amount: '1000000000',
        })
      ).rejects.toBeInstanceOf(SoroswapConfigError);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
