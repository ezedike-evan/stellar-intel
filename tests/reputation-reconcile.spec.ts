import { describe, expect, it, vi } from 'vitest';
import {
  calculateDeliveredRate,
  fetchPaymentsForTransaction,
  isDueForReconciliation,
  reconcileReputationOutcomes,
  selectDeliveredPayment,
  type ReconciledOutcomeUpdate,
  type ReputationOutcomeRow,
} from '@/lib/reputation/reconcile';

describe('reputation reconciler', () => {
  const now = new Date('2026-06-02T12:00:00.000Z');

  it('selects the delivered payment from Horizon records using row constraints', () => {
    const row: ReputationOutcomeRow = {
      id: 'row-1',
      status: 'completed',
      stellarTransactionId: 'tx-hash',
      destinationAccount: 'GDEST',
      deliveredAssetCode: 'USDC',
    };

    const payment = selectDeliveredPayment(row, [
      { type: 'payment', amount: '12.00', to: 'GOTHER', asset_code: 'USDC' },
      { type: 'payment', amount: '97.50', to: 'GDEST', asset_code: 'USDC' },
    ]);

    expect(payment?.amount).toBe('97.50');
  });

  it('marks completed rows with a stellar transaction id as due inside the settle window', () => {
    expect(
      isDueForReconciliation(
        {
          id: 'row-1',
          status: 'completed',
          stellarTransactionId: 'tx-hash',
          settledAt: '2026-06-02T11:56:00.000Z',
        },
        now
      )
    ).toBe(true);
  });

  it('skips rows without a stellar transaction id or already backfilled delivery', () => {
    expect(isDueForReconciliation({ id: 'row-1', status: 'completed' }, now)).toBe(false);
    expect(
      isDueForReconciliation(
        {
          id: 'row-2',
          status: 'completed',
          stellarTransactionId: 'tx-hash',
          deliveredAmount: '100',
        },
        now
      )
    ).toBe(false);
  });

  it('calculates delivered rate from the actual delivered amount and quoted basis', () => {
    expect(
      calculateDeliveredRate({ id: 'row-1', status: 'completed', quotedAmount: '120' }, '108')
    ).toBe('0.90000000');
  });

  it('backfills delivered amount and rate from Horizon within 5 minutes of settle', async () => {
    const updates: Array<{ row: ReputationOutcomeRow; update: ReconciledOutcomeUpdate }> = [];
    const updateOutcome = vi.fn(
      async (row: ReputationOutcomeRow, update: ReconciledOutcomeUpdate) => {
        updates.push({ row, update });
      }
    );

    const results = await reconcileReputationOutcomes(
      [
        {
          id: 'row-1',
          status: 'completed',
          stellarTransactionId: 'tx-hash',
          settledAt: '2026-06-02T11:58:00.000Z',
          quotedAmount: '100',
          destinationAccount: 'GDEST',
        },
      ],
      updateOutcome,
      {
        now,
        fetchPaymentsForTransaction: vi.fn(async () => [
          { type: 'payment', amount: '94.2500000', to: 'GDEST' },
        ]),
      }
    );

    expect(updateOutcome).toHaveBeenCalledTimes(1);
    expect(updates[0]?.update).toEqual({
      deliveredAmount: '94.2500000',
      deliveredRate: '0.94250000',
      reconciledAt: now,
      stellarTransactionId: 'tx-hash',
    });
    expect(results).toEqual([
      {
        rowId: 'row-1',
        status: 'updated',
        deliveredAmount: '94.2500000',
        deliveredRate: '0.94250000',
      },
    ]);
  });

  it('fetches payments from Horizon by stellar transaction id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          _embedded: {
            records: [{ type: 'payment', amount: '42.0000000', transaction_hash: 'tx-hash' }],
          },
        })
      )
    );

    await expect(fetchPaymentsForTransaction('tx-hash')).resolves.toEqual([
      { type: 'payment', amount: '42.0000000', transaction_hash: 'tx-hash' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://horizon.stellar.org/transactions/tx-hash/payments'
    );

    fetchMock.mockRestore();
  });
});
