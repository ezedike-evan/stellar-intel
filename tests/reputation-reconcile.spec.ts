import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as reconcileGET } from '@/app/api/reputation/reconcile/route';
import {
  calculateDeliveredRate,
  fetchPaymentsForTransaction,
  isDueForReconciliation,
  reconcileReputationOutcomes,
  selectDeliveredPayment,
  type ReconciledOutcomeUpdate,
  type ReputationOutcomeRow,
} from '@/lib/reputation/reconcile';
import {
  InMemorySlippageBreachStore,
  _setSlippageBreachStore,
  type SlippageBreach,
  type SlippageEvidence,
} from '@/lib/reputation/slippage-breaches';
import { hashSlippageEvidence } from '@/lib/reputation/slippage-evidence';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';

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

  it('updates when the delivered payment source matches the signer account (#1334)', async () => {
    const updateOutcome = vi.fn(async () => {});

    const results = await reconcileReputationOutcomes(
      [
        {
          id: 'row-1',
          status: 'completed',
          stellarTransactionId: 'tx-hash',
          settledAt: '2026-06-02T11:58:00.000Z',
          quotedAmount: '100',
          destinationAccount: 'GDEST',
          signerAccount: 'GSIGNER',
        },
      ],
      updateOutcome,
      {
        now,
        fetchPaymentsForTransaction: vi.fn(async () => [
          { type: 'payment', amount: '94.2500000', to: 'GDEST', from: 'GSIGNER' },
        ]),
      }
    );

    expect(updateOutcome).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        rowId: 'row-1',
        status: 'updated',
        deliveredAmount: '94.2500000',
        deliveredRate: '0.94250000',
      },
    ]);
  });

  it('flags source_mismatch and skips the update when the payment source differs from the signer (#1334)', async () => {
    const updateOutcome = vi.fn(async () => {});
    const onSourceMismatch = vi.fn(async () => {});

    const results = await reconcileReputationOutcomes(
      [
        {
          id: 'row-1',
          status: 'completed',
          stellarTransactionId: 'tx-hash',
          settledAt: '2026-06-02T11:58:00.000Z',
          quotedAmount: '100',
          destinationAccount: 'GDEST',
          signerAccount: 'GSIGNER',
        },
      ],
      updateOutcome,
      {
        now,
        fetchPaymentsForTransaction: vi.fn(async () => [
          { type: 'payment', amount: '94.2500000', to: 'GDEST', from: 'GSOMEONE_ELSE' },
        ]),
        onSourceMismatch,
      }
    );

    expect(updateOutcome).not.toHaveBeenCalled();
    expect(onSourceMismatch).toHaveBeenCalledTimes(1);
    expect(onSourceMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', signerAccount: 'GSIGNER' })
    );
    expect(results).toEqual([{ rowId: 'row-1', status: 'source_mismatch' }]);
  });

  it('honours source_account when from is absent (#1334)', async () => {
    const updateOutcome = vi.fn(async () => {});

    const results = await reconcileReputationOutcomes(
      [
        {
          id: 'row-1',
          status: 'completed',
          stellarTransactionId: 'tx-hash',
          settledAt: '2026-06-02T11:58:00.000Z',
          quotedAmount: '100',
          destinationAccount: 'GDEST',
          signerAccount: 'GSIGNER',
        },
      ],
      updateOutcome,
      {
        now,
        fetchPaymentsForTransaction: vi.fn(async () => [
          { type: 'payment', amount: '94.2500000', to: 'GDEST', source_account: 'GSIGNER' },
        ]),
      }
    );

    expect(updateOutcome).toHaveBeenCalledTimes(1);
    expect(results[0]?.status).toBe('updated');
  });

  it("keeps today's behaviour when signerAccount is null (#1334)", async () => {
    const updateOutcome = vi.fn(async () => {});
    const onSourceMismatch = vi.fn(async () => {});

    const results = await reconcileReputationOutcomes(
      [
        {
          id: 'row-1',
          status: 'completed',
          stellarTransactionId: 'tx-hash',
          settledAt: '2026-06-02T11:58:00.000Z',
          quotedAmount: '100',
          destinationAccount: 'GDEST',
          signerAccount: null,
        },
      ],
      updateOutcome,
      {
        now,
        fetchPaymentsForTransaction: vi.fn(async () => [
          { type: 'payment', amount: '94.2500000', to: 'GDEST', from: 'GSOMEONE_ELSE' },
        ]),
        onSourceMismatch,
      }
    );

    expect(onSourceMismatch).not.toHaveBeenCalled();
    expect(updateOutcome).toHaveBeenCalledTimes(1);
    expect(results[0]?.status).toBe('updated');
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

describe('GET /api/reputation/reconcile — slippage verification (#2105)', () => {
  const SIGNER = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
  const ANCHOR = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  // The issuer of NGNT, the source asset of the `ngnt-ngn` corridor.
  const NGNT_ISSUER = 'GAWODAROMJ33V5YDFY3NPYTHVYQG7MJXVJ2ND3AOGIHYRWINES6ACCPD';
  const TX = 'b'.repeat(64);

  let reputation: InMemoryReputationStore;
  let breaches: InMemorySlippageBreachStore;

  beforeEach(() => {
    reputation = new InMemoryReputationStore();
    breaches = new InMemorySlippageBreachStore();
    _setReputationStore(reputation);
    _setSlippageBreachStore(breaches);
  });

  afterEach(async () => {
    _setSlippageBreachStore(null);
    vi.unstubAllGlobals();
    await reputation.close();
    _setReputationStore(null);
  });

  const call = () =>
    reconcileGET(
      new NextRequest('http://localhost/api/reputation/reconcile', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    );

  async function detectedBreach(): Promise<SlippageBreach> {
    const evidence: SlippageEvidence = {
      v: 1,
      networkPassphrase: 'Test SDF Network ; September 2015',
      intentHash: 'a'.repeat(64),
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      signerAccount: SIGNER,
      minReceive: '1400',
      anchorReported: {
        anchorTransactionId: 'anchor-tx-1',
        amountOut: '1350',
        reportedBy: 'sender',
      },
      shortfall: '50',
      shortfallBps: 357,
      onChain: null,
      detectedAt: '2026-11-22T10:00:00.000Z',
    };
    return {
      intentHash: evidence.intentHash,
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      signerAccount: SIGNER,
      minReceive: '1400',
      amountOut: '1350',
      shortfall: '50',
      shortfallBps: 357,
      stellarTransactionId: TX,
      anchorTransactionId: 'anchor-tx-1',
      status: 'detected',
      rejectionReason: null,
      evidence,
      evidenceHash: await hashSlippageEvidence(evidence),
      detectedAt: evidence.detectedAt,
      verifiedAt: null,
    };
  }

  it('reports the verification pass next to the reconciliation, all zeros when there is no breach', async () => {
    const res = await call();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slippage).toEqual({ scanned: 0, verified: 0, rejected: 0, failed: 0 });
    // What the route reported before is still there.
    expect(body).toMatchObject({ scanned: 0, updated: 0, sourceMismatch: 0, results: [] });
  });

  it('answers 200 with slippage: null when the verification pass itself fails', async () => {
    _setSlippageBreachStore({
      create: async () => true,
      get: async () => null,
      list: async () => {
        throw new Error('db down');
      },
      resolveVerification: async () => null,
    });

    const res = await call();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slippage).toBeNull();
    expect(body).toMatchObject({ scanned: 0, updated: 0, sourceMismatch: 0 });
  });

  it('verifies a detected breach against Horizon in the same run', async () => {
    const breach = await detectedBreach();
    await breaches.create(breach);
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        asked.push(url);
        if (url.endsWith(`/transactions/${TX}/payments`)) {
          return {
            ok: true,
            json: async () => ({
              _embedded: {
                records: [
                  {
                    type: 'payment',
                    amount: '100.0000000',
                    asset_type: 'credit_alphanum4',
                    asset_code: 'NGNT',
                    asset_issuer: NGNT_ISSUER,
                    from: SIGNER,
                    to: ANCHOR,
                  },
                ],
              },
            }),
          };
        }
        if (url.endsWith(`/transactions/${TX}`)) {
          return {
            ok: true,
            json: async () => ({
              hash: TX,
              successful: true,
              ledger: 5_884_099,
              created_at: '2026-11-22T09:59:30Z',
              source_account: SIGNER,
              memo_type: 'none',
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      })
    );

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).slippage).toEqual({
      scanned: 1,
      verified: 1,
      rejected: 0,
      failed: 0,
    });
    expect(asked.filter((url) => url.endsWith(`/transactions/${TX}`))).toHaveLength(1);
    expect(asked.filter((url) => url.endsWith(`/transactions/${TX}/payments`))).toHaveLength(1);
    const verified = await breaches.get(breach.intentHash);
    expect(verified?.status).toBe('verified');
    expect(verified?.evidence.onChain).toMatchObject({
      txHash: TX,
      from: SIGNER,
      to: ANCHOR,
      assetCode: 'NGNT',
      amount: '100.0000000',
      memo: null,
    });
  });

  it('rejects a breach whose transaction Horizon does not have, and still answers 200', async () => {
    const breach = await detectedBreach();
    await breaches.create(breach);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    );

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).slippage).toEqual({
      scanned: 1,
      verified: 0,
      rejected: 1,
      failed: 0,
    });
    const rejected = await breaches.get(breach.intentHash);
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectionReason).toBe('transaction_not_found');
    expect(rejected?.evidenceHash).toBe(breach.evidenceHash);
  });
});
