// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { verifyRefundPayments, type RefundPaymentLoader } from '@/lib/refunds/verify-onchain';
import type { HorizonPaymentRecord } from '@/lib/reputation/reconcile';
import type { RefundAckPayment } from '@/lib/refunds/ack';

const ACCOUNT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const OTHER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const TX1 = 'a'.repeat(64);
const TX2 = 'B'.repeat(64);

function record(overrides: Partial<HorizonPaymentRecord> = {}): HorizonPaymentRecord {
  return {
    type: 'payment',
    amount: '100.0000000',
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    to: ACCOUNT,
    from: OTHER,
    ...overrides,
  };
}

function stellar(id: string, amount = '100'): RefundAckPayment {
  return { id, idType: 'stellar', amount };
}

function loaderOf(map: Record<string, HorizonPaymentRecord[]>): RefundPaymentLoader {
  return vi.fn(async (id: string) => map[id] ?? []);
}

describe('verifyRefundPayments (Issue #2118)', () => {
  it('verifies a single matching payment', async () => {
    const loader = loaderOf({ [TX1]: [record({ amount: '100' })] });
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1)],
      loader,
    });
    expect(result).toBe('verified');
    expect(loader).toHaveBeenCalledWith(TX1);
  });

  it("treats '100' and '100.0000000' as equal amounts", async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1, '100')],
      loader: loaderOf({ [TX1]: [record({ amount: '100.0000000' })] }),
    });
    expect(result).toBe('verified');
  });

  it('verifies multiple payments, ignoring external ones and accepting path payments', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [
        stellar(TX1, '40'),
        { id: 'bank-ref-1', idType: 'external', amount: '10' },
        stellar(TX2, '50'),
      ],
      loader: loaderOf({
        [TX1]: [record({ amount: '40' })],
        [TX2]: [
          record({ type: 'create_account', amount: '1' }),
          record({ type: 'path_payment_strict_receive', amount: '50.0000000' }),
        ],
      }),
    });
    expect(result).toBe('verified');
  });

  it('returns mismatch when the payment went to another account', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1)],
      loader: loaderOf({ [TX1]: [record({ to: OTHER })] }),
    });
    expect(result).toBe('mismatch');
  });

  it('returns mismatch when the asset differs', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1)],
      loader: loaderOf({ [TX1]: [record({ asset_code: 'EURC' })] }),
    });
    expect(result).toBe('mismatch');
  });

  it('returns mismatch when the amount differs', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1, '100')],
      loader: loaderOf({ [TX1]: [record({ amount: '99.9999999' })] }),
    });
    expect(result).toBe('mismatch');
  });

  it('returns mismatch for a non-payment operation type', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1)],
      loader: loaderOf({ [TX1]: [record({ type: 'create_account' })] }),
    });
    expect(result).toBe('mismatch');
  });

  it('returns mismatch when one of several payments is unmatched', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1), stellar(TX2)],
      loader: loaderOf({ [TX1]: [record()] }),
    });
    expect(result).toBe('mismatch');
  });

  it('returns mismatch for a stellar payment id that is not a transaction hash', async () => {
    const loader = loaderOf({});
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar('not-a-hash')],
      loader,
    });
    expect(result).toBe('mismatch');
    expect(loader).not.toHaveBeenCalled();
  });

  it('returns unverifiable when there are only external payments', async () => {
    const loader = loaderOf({});
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [{ id: 'bank-ref-1', idType: 'external', amount: '100' }],
      loader,
    });
    expect(result).toBe('unverifiable');
    expect(loader).not.toHaveBeenCalled();
  });

  it('returns unverifiable when there are no payments at all', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [],
      loader: loaderOf({}),
    });
    expect(result).toBe('unverifiable');
  });

  it('returns unverifiable when the loader throws', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1)],
      loader: async () => {
        throw new Error('Horizon payment lookup failed: HTTP 503');
      },
    });
    expect(result).toBe('unverifiable');
  });

  it('returns unverifiable when the loader never resolves before timeoutMs', async () => {
    const result = await verifyRefundPayments({
      account: ACCOUNT,
      assetCode: 'USDC',
      payments: [stellar(TX1)],
      loader: () => new Promise<HorizonPaymentRecord[]>(() => {}),
      timeoutMs: 10,
    });
    expect(result).toBe('unverifiable');
  });
});
