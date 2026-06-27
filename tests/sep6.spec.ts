import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  getSep6Info,
  getSep6Transaction,
  hasSep6,
  getSep6TransferServer,
  Sep6AssetDisabledError,
  TERMINAL_STATES,
} from '@/lib/stellar/sep6';
import { TimeoutError, Sep6NotSupportedError } from '@/lib/stellar/errors';

const TRANSFER_SERVER = 'https://sep6.example.com';
const TRANSACTION_ID = 'txn-sep6-abc123';
const JWT = 'test-jwt-sep6';

/** Canonical SEP-6 /info fixture matching the SEP-6 spec shape. */
const FIXTURE = {
  deposit: {
    USDC: {
      enabled: true,
      fee_fixed: 2.5,
      fee_percent: 0.1,
      min_amount: 5,
      max_amount: 50000,
      fields: {
        transaction: {
          receiver_account_number: { description: 'Bank account number' },
          type: { description: 'Transfer type', choices: ['SEPA', 'SWIFT'] },
        },
      },
    },
  },
  withdraw: {
    USDC: {
      enabled: true,
      fee_fixed: 2.5,
      fee_percent: 0.1,
      min_amount: 10,
      max_amount: 25000,
      fields: {
        transaction: {
          sender_account_number: { description: 'Your bank account number' },
        },
      },
    },
    EUR: {
      enabled: false,
      fee_fixed: 1,
      fee_percent: 0,
      min_amount: 5,
      max_amount: 10000,
      fields: {},
    },
  },
  fee: { enabled: true },
  transaction: { enabled: true },
  transactions: { enabled: true },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── getSep6Info ──────────────────────────────────────────────────────────────

describe('getSep6Info', () => {
  it('returns normalized withdraw config for a valid, enabled asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => FIXTURE,
      }))
    );

    const result = await getSep6Info(TRANSFER_SERVER, 'USDC');

    expect(result.enabled).toBe(true);
    expect(result.feeFixed).toBe(2.5);
    expect(result.feePercent).toBe(0.1);
    expect(result.min).toBe(10);
    expect(result.max).toBe(25000);
    expect(result.fields).toEqual(FIXTURE.withdraw['USDC'].fields);
  });

  it('fetches /info at the correct URL', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return { ok: true, json: async () => FIXTURE };
      })
    );

    await getSep6Info(TRANSFER_SERVER, 'USDC');
    expect(capturedUrl).toBe(`${TRANSFER_SERVER}/info`);
  });

  it('defaults feeFixed/feePercent/min/max to 0 when absent from response', async () => {
    const sparseFixture = {
      ...FIXTURE,
      withdraw: {
        USDC: { enabled: true },
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => sparseFixture }))
    );

    const result = await getSep6Info(TRANSFER_SERVER, 'USDC');

    expect(result.feeFixed).toBe(0);
    expect(result.feePercent).toBe(0);
    expect(result.min).toBe(0);
    expect(result.max).toBe(0);
    expect(result.fields).toEqual({});
  });

  it('throws Sep6AssetDisabledError when enabled is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => FIXTURE }))
    );

    await expect(getSep6Info(TRANSFER_SERVER, 'EUR')).rejects.toThrow(Sep6AssetDisabledError);
    await expect(getSep6Info(TRANSFER_SERVER, 'EUR')).rejects.toThrow(
      /EUR.*not enabled.*SEP-6 withdraw/
    );
  });

  it('throws Sep6AssetDisabledError when asset is missing from withdraw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => FIXTURE }))
    );

    await expect(getSep6Info(TRANSFER_SERVER, 'XYZ')).rejects.toThrow(Sep6AssetDisabledError);
    await expect(getSep6Info(TRANSFER_SERVER, 'XYZ')).rejects.toThrow(
      /XYZ.*not enabled.*SEP-6 withdraw/
    );
  });

  it('throws Sep6AssetDisabledError when withdraw object is missing entirely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ deposit: {}, fee: { enabled: true } }),
      }))
    );

    await expect(getSep6Info(TRANSFER_SERVER, 'USDC')).rejects.toThrow(Sep6AssetDisabledError);
  });

  it('throws TimeoutError after 8 seconds', async () => {
    vi.useFakeTimers();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );

    const promise = getSep6Info(TRANSFER_SERVER, 'USDC');

    vi.advanceTimersByTime(8_001);

    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow(/timed out/);

    vi.useRealTimers();
  });

  it('throws SepError on a non-ok HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }))
    );

    await expect(getSep6Info(TRANSFER_SERVER, 'USDC')).rejects.toThrow(/HTTP 500/);
  });

  it('exposes assetCode and transferServer on Sep6AssetDisabledError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => FIXTURE }))
    );

    try {
      await getSep6Info(TRANSFER_SERVER, 'EUR');
      expect.fail('expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(Sep6AssetDisabledError);
      const typed = err as Sep6AssetDisabledError;
      expect(typed.assetCode).toBe('EUR');
      expect(typed.transferServer).toBe(TRANSFER_SERVER);
    }
  });
});

// ─── getSep6Transaction ───────────────────────────────────────────────────────

describe('getSep6Transaction', () => {
  it('fetches the correct URL with Authorization header', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = opts.headers as Record<string, string>;
        return {
          ok: true,
          json: async () => ({
            transaction: { id: TRANSACTION_ID, status: 'pending_external' },
          }),
        };
      })
    );

    await getSep6Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT);

    expect(capturedUrl).toBe(`${TRANSFER_SERVER}/transaction?id=${TRANSACTION_ID}`);
    expect(capturedHeaders['Authorization']).toBe(`Bearer ${JWT}`);
  });

  it('returns all mapped fields on a well-formed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: {
            id: TRANSACTION_ID,
            status: 'completed',
            amount_in: '100.00',
            amount_out: '155000.00',
            amount_fee: '2.00',
            stellar_transaction_id: 'stellar-hash-sep6-xyz',
          },
        }),
      }))
    );

    const result = await getSep6Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT);

    expect(result.id).toBe(TRANSACTION_ID);
    expect(result.status).toBe('completed');
    expect(result.amountIn).toBe('100.00');
    expect(result.amountOut).toBe('155000.00');
    expect(result.amountFee).toBe('2.00');
    expect(result.stellarTransactionId).toBe('stellar-hash-sep6-xyz');
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it('maps a known status correctly (pending_anchor stays pending_anchor, normalizedStatus is pending_anchor)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transaction: { id: TRANSACTION_ID, status: 'pending_anchor' } }),
      }))
    );

    const result = await getSep6Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT);
    expect(result.status).toBe('pending_anchor');
    expect(result.normalizedStatus).toBe('pending_anchor');
  });

  it('defaults an unknown anchor status to "pending_external" without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: { id: TRANSACTION_ID, status: 'some_custom_anchor_state' },
        }),
      }))
    );

    const result = await getSep6Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT);
    expect(result.status).toBe('pending_external');
  });

  it('defaults a missing status to "pending_external"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transaction: { id: TRANSACTION_ID } }),
      }))
    );

    const result = await getSep6Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT);
    expect(result.status).toBe('pending_external');
  });

  it('uses transactionId as fallback when id is absent from the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transaction: { status: 'pending_external' } }),
      }))
    );

    const result = await getSep6Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT);
    expect(result.id).toBe(TRANSACTION_ID);
  });

  it('throws on a 404 non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }))
    );

    await expect(getSep6Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)).rejects.toThrow(
      /HTTP 404/
    );
  });

  it('unknown status normalizedStatus maps to "pending_external"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: { id: TRANSACTION_ID, status: 'unknown_custom_status' },
        }),
      }))
    );

    const result = await getSep6Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT);
    expect(result.normalizedStatus).toBe('pending_external');
  });
});

// ─── TERMINAL_STATES ──────────────────────────────────────────────────────────

describe('TERMINAL_STATES', () => {
  it('includes completed, error, and refunded', () => {
    expect(TERMINAL_STATES.has('completed')).toBe(true);
    expect(TERMINAL_STATES.has('error')).toBe(true);
    expect(TERMINAL_STATES.has('refunded')).toBe(true);
  });

  it('does not include pending_external or pending_anchor', () => {
    expect(TERMINAL_STATES.has('pending_external')).toBe(false);
    expect(TERMINAL_STATES.has('pending_anchor')).toBe(false);
  });
});
// ─── Fee model table tests ────────────────────────────────────────────────────

describe('getSep6Info — fee model parsing', () => {
  const feeModelCases = [
    {
      label: 'flat-fee only',
      feeFixed: 3,
      feePercent: 0,
      expected: { feeFixed: 3, feePercent: 0 },
    },
    {
      label: 'percent-fee only',
      feeFixed: 0,
      feePercent: 1.5,
      expected: { feeFixed: 0, feePercent: 1.5 },
    },
    {
      label: 'combined flat + percent fee',
      feeFixed: 2,
      feePercent: 0.5,
      expected: { feeFixed: 2, feePercent: 0.5 },
    },
  ] as const;

  it.each(feeModelCases)('parses $label correctly', async ({ feeFixed, feePercent, expected }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          withdraw: {
            USDC: {
              enabled: true,
              fee_fixed: feeFixed,
              fee_percent: feePercent,
              min_amount: 10,
              max_amount: 10000,
              fields: {},
            },
          },
        }),
      }))
    );

    const result = await getSep6Info(TRANSFER_SERVER, 'USDC');

    expect(result.feeFixed).toBe(expected.feeFixed);
    expect(result.feePercent).toBe(expected.feePercent);
  });
});

// ─── Property test: fee monotonicity ─────────────────────────────────────────

describe('fee→rate derivation — property tests', () => {
  it('higher fee_percent never increases totalReceived', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 10, max: 10000, noNaN: true }),
        fc.float({ min: 0, max: 50, noNaN: true }),
        fc.float({ min: 0, max: 50, noNaN: true }),
        async (amount, feePercentA, feePercentB) => {
          const makeFixture = (pct: number) => ({
            withdraw: {
              USDC: {
                enabled: true,
                fee_fixed: 0,
                fee_percent: pct,
                min_amount: 0,
                max_amount: 100000,
                fields: {},
              },
            },
          });

          vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, json: async () => makeFixture(feePercentA) }))
          );
          const resultA = await getSep6Info(TRANSFER_SERVER, 'USDC');

          vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, json: async () => makeFixture(feePercentB) }))
          );
          const resultB = await getSep6Info(TRANSFER_SERVER, 'USDC');

          const totalReceivedA = amount * (1 - resultA.feePercent / 100);
          const totalReceivedB = amount * (1 - resultB.feePercent / 100);

          if (feePercentA <= feePercentB) {
            expect(totalReceivedA).toBeGreaterThanOrEqual(totalReceivedB);
          } else {
            expect(totalReceivedA).toBeLessThanOrEqual(totalReceivedB);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Capability detection (network-free TOML inspection) ──────────────────────

describe('hasSep6', () => {
  it('returns true for a toml that advertises TRANSFER_SERVER', () => {
    expect(hasSep6({ TRANSFER_SERVER: 'https://anchor.example.com/sep6' })).toBe(true);
  });

  it('returns false when TRANSFER_SERVER is absent', () => {
    expect(hasSep6({})).toBe(false);
  });

  it('returns false for a blank or whitespace-only TRANSFER_SERVER', () => {
    expect(hasSep6({ TRANSFER_SERVER: '   ' })).toBe(false);
    expect(hasSep6({ TRANSFER_SERVER: null })).toBe(false);
  });
});

describe('getSep6TransferServer', () => {
  it('returns the trimmed transfer server URL when present', () => {
    expect(getSep6TransferServer({ TRANSFER_SERVER: '  https://anchor.example.com/sep6  ' })).toBe(
      'https://anchor.example.com/sep6'
    );
  });

  it('throws a typed Sep6NotSupportedError when absent', () => {
    expect(() => getSep6TransferServer({ domain: 'anchor.example.com' })).toThrow(
      Sep6NotSupportedError
    );
  });
});
