import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchAnchorFee,
  fetchAllAnchorFees,
  computeRateComparison,
  getWithdrawTransactionRecord,
} from '@/lib/stellar/sep24';
import * as sep1 from '@/lib/stellar/sep1';
import type { AnchorRate } from '@/types';

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24';

const MOCK_ANCHOR = {
  id: 'cowrie',
  name: 'Cowrie',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

const RESOLVED_ANCHOR = {
  ...MOCK_ANCHOR,
  TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
  WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
  SIGNING_KEY: 'G...',
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
  domain: 'anchor.domain',
  ANCHOR_QUOTE_SERVER: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(sep1, 'getTransferServer').mockResolvedValue(TRANSFER_SERVER);
});

// ─── fetchAnchorFee ───────────────────────────────────────────────────────────

describe('fetchAnchorFee', () => {
  const params = {
    anchorDomain: 'cowrie.exchange',
    operation: 'withdraw' as const,
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount: '100',
    type: 'bank_account' as const,
  };

  it('constructs the correct fee URL with all query parameters', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ fee: '2.00' }) };
      })
    );

    await fetchAnchorFee(params);

    expect(capturedUrl).toContain('operation=withdraw');
    expect(capturedUrl).toContain('asset_code=USDC');
    expect(capturedUrl).toContain('amount=100');
    expect(capturedUrl).toContain('type=bank_account');
  });

  it('correctly parses a { fee: "2.00" } response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fee: '2.00' }),
      }))
    );

    const result = await fetchAnchorFee(params);
    expect(result.fee).toBe('2.00');
  });

  it('throws a descriptive error on HTTP 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400 }))
    );

    await expect(fetchAnchorFee(params)).rejects.toThrow(/HTTP 400.*cowrie\.exchange/);
  });

  it('throws a timeout error when the request exceeds 10 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            (err as NodeJS.ErrnoException).name = 'AbortError';
            reject(err);
          });
        });
      })
    );

    const [, result] = await Promise.allSettled([vi.runAllTimersAsync(), fetchAnchorFee(params)]);
    expect(result.status).toBe('rejected');
    expect((result as PromiseRejectedResult).reason.message).toMatch(/timed out/);
    vi.useRealTimers();
  });
});

// ─── fetchAllAnchorFees ───────────────────────────────────────────────────────

describe('fetchAllAnchorFees', () => {
  it('returns partial results when one anchor fails', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount++;
        if (callCount === 1)
          return { ok: true, json: async () => ({ fee: '2.00', exchange_rate: '1580' }) };
        throw new Error('network error');
      })
    );

    const results = await fetchAllAnchorFees('100', 'usdc-brl');
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBeGreaterThan(0);
    expect(rejected.length).toBeGreaterThan(0);
  });
});

// ─── computeRateComparison ────────────────────────────────────────────────────

describe('computeRateComparison', () => {
  it('identifies the anchor with the highest totalReceived as bestRateId', () => {
    const results: PromiseSettledResult<AnchorRate>[] = [
      {
        status: 'fulfilled',
        value: {
          anchorId: 'cowrie',
          anchorName: 'Cowrie',
          corridorId: 'usdc-ngn',
          fee: 3,
          feeType: 'flat',
          exchangeRate: 1580,
          totalReceived: 97 * 1580,
          source: 'sep24-fee' as const,
          updatedAt: new Date(),
          expiresAt: undefined,
        },
      },
      {
        status: 'fulfilled',
        value: {
          anchorId: 'moneygram',
          anchorName: 'MoneyGram',
          corridorId: 'usdc-ngn',
          fee: 1.5,
          feeType: 'flat',
          exchangeRate: 1580,
          totalReceived: 98.5 * 1580,
          source: 'sep24-fee' as const,
          updatedAt: new Date(),
          expiresAt: undefined,
        },
      },
    ];

    const comparison = computeRateComparison(results, 'usdc-ngn');
    expect(comparison.bestRateId).toBe('moneygram');
    expect(comparison.rates).toHaveLength(2);
  });

  it('returns an empty comparison when all results are rejected', () => {
    const results: PromiseSettledResult<AnchorRate>[] = [
      { status: 'rejected', reason: new Error('timeout') },
    ];
    const comparison = computeRateComparison(results, 'usdc-ngn');
    expect(comparison.rates).toHaveLength(0);
    expect(comparison.bestRateId).toBe('');
    expect(comparison.pending).toEqual([]);
  });
});

// ─── getWithdrawTransactionRecord ─────────────────────────────────────────────

describe('getWithdrawTransactionRecord', () => {
  it('extracts memo and anchor account correctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: {
            withdraw_anchor_account: 'GANCHOR',
            memo: 'abc123',
            memo_type: 'text',
          },
        }),
      }))
    );

    const result = await getWithdrawTransactionRecord(TRANSFER_SERVER, 'txn-1', 'jwt');
    expect(result.withdrawAnchorAccount).toBe('GANCHOR');
    expect(result.memo).toBe('abc123');
    expect(result.memoType).toBe('text');
  });

  it('returns the anchor amount estimate fields when the record carries them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: {
            withdraw_anchor_account: 'GANCHOR',
            memo: 'abc123',
            memo_type: 'text',
            amount_in: '100.0000000',
            amount_out: '151743.20',
            amount_out_asset: 'iso4217:NGN',
            amount_fee: '1.5',
          },
        }),
      }))
    );

    const result = await getWithdrawTransactionRecord(TRANSFER_SERVER, 'txn-1', 'jwt');
    expect(result).toMatchObject({
      amountIn: '100.0000000',
      amountOut: '151743.20',
      amountOutAsset: 'iso4217:NGN',
      amountFee: '1.5',
    });
  });

  it('falls back to fee_details.total when amount_fee is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: {
            withdraw_anchor_account: 'GANCHOR',
            fee_details: { total: '2.25' },
          },
        }),
      }))
    );

    const result = await getWithdrawTransactionRecord(TRANSFER_SERVER, 'txn-1', 'jwt');
    expect(result.amountFee).toBe('2.25');
  });

  it('omits the amount fields when the record has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: { withdraw_anchor_account: 'GANCHOR', memo: 'abc123' },
        }),
      }))
    );

    const result = await getWithdrawTransactionRecord(TRANSFER_SERVER, 'txn-1', 'jwt');
    expect(result).toEqual({ withdrawAnchorAccount: 'GANCHOR', memo: 'abc123', memoType: 'text' });
  });

  it('throws when withdraw_anchor_account is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transaction: { memo: 'abc123' } }),
      }))
    );

    await expect(getWithdrawTransactionRecord(TRANSFER_SERVER, 'txn-1', 'jwt')).rejects.toThrow(
      /withdraw_anchor_account/
    );
  });
});
