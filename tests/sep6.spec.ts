import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSep6Info, Sep6AssetDisabledError } from '@/lib/stellar/sep6';
import { TimeoutError } from '@/lib/stellar/errors';

const TRANSFER_SERVER = 'https://sep6.example.com';

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

    // Promise that never resolves
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
