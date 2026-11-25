import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HorizonPaymentRecord } from '@/lib/reputation/reconcile';
import {
  InMemorySlippageBreachStore,
  type SlippageBreach,
  type SlippageBreachStore,
  type SlippageEvidence,
} from '@/lib/reputation/slippage-breaches';
import { hashSlippageEvidence } from '@/lib/reputation/slippage-evidence';
import {
  fetchStellarTransaction,
  verifyDetectedBreaches,
  type HorizonTransactionRecord,
} from '@/lib/reputation/slippage-verify';

// No corridor in the registry sells native XLM, so one is added for the test of that
// branch. Everything else in the module is the real thing.
vi.mock('@/constants/anchors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/constants/anchors')>();
  return {
    ...actual,
    CORRIDORS: [
      ...actual.CORRIDORS,
      {
        id: 'xlm-ngn',
        from: 'XLM',
        fromIssuer: null,
        fromPeg: 'XLM',
        to: 'NGN',
        countryCode: 'NG',
        countryName: 'Nigeria',
      },
    ],
  };
});

const SIGNER = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
const OTHER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const ANCHOR = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
// The issuer of NGNT, the source asset of the `ngnt-ngn` corridor.
const NGNT_ISSUER = 'GAWODAROMJ33V5YDFY3NPYTHVYQG7MJXVJ2ND3AOGIHYRWINES6ACCPD';
const TX = 'b'.repeat(64);
const NOW = new Date('2026-11-23T08:00:00.000Z');

let n = 0;
async function breach(over: Partial<SlippageBreach> = {}): Promise<SlippageBreach> {
  n += 1;
  const intentHash = over.intentHash ?? n.toString(16).padStart(64, '0');
  const corridor = over.corridor ?? 'ngnt-ngn';
  const evidence: SlippageEvidence = {
    v: 1,
    networkPassphrase: 'Test SDF Network ; September 2015',
    intentHash,
    anchorId: 'cowrie',
    corridor,
    signerAccount: SIGNER,
    minReceive: '1400',
    anchorReported: { anchorTransactionId: 'anchor-tx-1', amountOut: '1350', reportedBy: 'sender' },
    shortfall: '50',
    shortfallBps: 357,
    onChain: null,
    // Later breaches are newer, so a list comes back in the reverse of creation order.
    detectedAt: new Date(Date.parse('2026-11-22T10:00:00.000Z') + n * 1000).toISOString(),
  };
  return {
    intentHash,
    anchorId: 'cowrie',
    corridor,
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
    ...over,
  };
}

/** A fixture override: a field given as `undefined` is left out of the record. */
type Override<T> = { [K in keyof T]?: T[K] | undefined };

function record<T extends object>(fields: Override<T>): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}

const transaction = (over: Override<HorizonTransactionRecord> = {}): HorizonTransactionRecord =>
  record<HorizonTransactionRecord>({
    hash: TX,
    successful: true,
    ledger: 5_884_099,
    created_at: '2026-11-22T09:59:30Z',
    source_account: SIGNER,
    memo_type: 'text',
    memo: 'cowrie-42',
    ...over,
  });

const payment = (over: Override<HorizonPaymentRecord> = {}): HorizonPaymentRecord =>
  record<HorizonPaymentRecord>({
    type: 'payment',
    amount: '100.0000000',
    asset_type: 'credit_alphanum4',
    asset_code: 'NGNT',
    asset_issuer: NGNT_ISSUER,
    from: SIGNER,
    to: ANCHOR,
    transaction_hash: TX,
    ...over,
  });

/** An error as `fetchStellarTransaction` throws it for an HTTP status. */
const httpError = (status: number) =>
  Object.assign(new Error(`Horizon transaction lookup failed: HTTP ${status}`), { status });

let store: InMemorySlippageBreachStore;

beforeEach(() => {
  store = new InMemorySlippageBreachStore();
});

function run(
  over: {
    loadTransaction?: (hash: string) => Promise<HorizonTransactionRecord>;
    loadPayments?: (hash: string) => Promise<HorizonPaymentRecord[]>;
    store?: SlippageBreachStore;
    limit?: number;
  } = {}
) {
  return verifyDetectedBreaches({
    store: over.store ?? store,
    loadTransaction: over.loadTransaction ?? (async () => transaction()),
    loadPayments: over.loadPayments ?? (async () => [payment()]),
    now: () => NOW,
    ...(over.limit === undefined ? {} : { limit: over.limit }),
  });
}

describe('verifyDetectedBreaches (#2105, SLP009)', () => {
  it('verifies a breach whose transaction holds the signer payment, and fills in the on-chain evidence', async () => {
    const detected = await breach();
    await store.create(detected);

    expect(await run()).toEqual({ scanned: 1, verified: 1, rejected: 0, failed: 0 });

    const verified = await store.get(detected.intentHash);
    expect(verified?.status).toBe('verified');
    expect(verified?.rejectionReason).toBeNull();
    expect(verified?.verifiedAt).toBe(NOW.toISOString());
    expect(verified?.evidence.onChain).toEqual({
      txHash: TX,
      ledger: 5_884_099,
      closedAt: '2026-11-22T09:59:30Z',
      successful: true,
      from: SIGNER,
      to: ANCHOR,
      assetCode: 'NGNT',
      assetIssuer: NGNT_ISSUER,
      amount: '100.0000000',
      memoType: 'text',
      memo: 'cowrie-42',
    });
    // The rest of the evidence is what was recorded at detection.
    expect({ ...verified?.evidence, onChain: null }).toEqual(detected.evidence);
    // The hash is the hash of the evidence now stored, and no longer the old one.
    expect(verified?.evidenceHash).toBe(await hashSlippageEvidence(verified!.evidence));
    expect(verified?.evidenceHash).not.toBe(detected.evidenceHash);
  });

  it('asks Horizon for the transaction the breach names, and its payments', async () => {
    await store.create(await breach());
    const loadTransaction = vi.fn(async () => transaction());
    const loadPayments = vi.fn(async () => [payment()]);

    await run({ loadTransaction, loadPayments });

    expect(loadTransaction).toHaveBeenCalledTimes(1);
    expect(loadTransaction).toHaveBeenCalledWith(TX);
    expect(loadPayments).toHaveBeenCalledTimes(1);
    expect(loadPayments).toHaveBeenCalledWith(TX);
  });

  it('writes a null memo when the transaction has none', async () => {
    const detected = await breach();
    await store.create(detected);

    await run({ loadTransaction: async () => transaction({ memo_type: 'none', memo: undefined }) });

    const onChain = (await store.get(detected.intentHash))?.evidence.onChain;
    expect(onChain?.memoType).toBe('none');
    expect(onChain?.memo).toBeNull();
  });

  it('picks the signer payment in the source asset out of the others in the transaction', async () => {
    const detected = await breach();
    await store.create(detected);

    const summary = await run({
      loadPayments: async () => [
        // Not a payment at all.
        payment({ type: 'create_account', amount: '9' }),
        // Somebody else's payment.
        payment({ from: OTHER, amount: '8' }),
        // The signer, in another asset.
        payment({ asset_code: 'USDC', amount: '7' }),
        // The right code under another issuer.
        payment({ asset_issuer: OTHER, amount: '6' }),
        // The signer's own XLM, in a corridor that sells NGNT.
        payment({
          asset_type: 'native',
          asset_code: undefined,
          asset_issuer: undefined,
          amount: '5',
        }),
        payment({ amount: '100.0000000' }),
      ],
    });

    expect(summary.verified).toBe(1);
    expect((await store.get(detected.intentHash))?.evidence.onChain?.amount).toBe('100.0000000');
  });

  it.each(['path_payment_strict_send', 'path_payment_strict_receive'])(
    'accepts a %s by the signer',
    async (type) => {
      const detected = await breach();
      await store.create(detected);

      expect((await run({ loadPayments: async () => [payment({ type })] })).verified).toBe(1);
    }
  );

  it('reads the payer from source_account when the record has no from', async () => {
    const detected = await breach();
    await store.create(detected);

    const summary = await run({
      loadPayments: async () => [payment({ from: undefined, source_account: SIGNER })],
    });

    expect(summary.verified).toBe(1);
    expect((await store.get(detected.intentHash))?.evidence.onChain?.from).toBe(SIGNER);
  });

  it('verifies a native-asset corridor, with XLM and no issuer in the evidence', async () => {
    const detected = await breach({ corridor: 'xlm-ngn' });
    await store.create(detected);

    const summary = await run({
      loadPayments: async () => [
        // An issued asset is not the source asset of this corridor.
        payment({ amount: '1' }),
        payment({
          asset_type: 'native',
          asset_code: undefined,
          asset_issuer: undefined,
          amount: '250.0000000',
        }),
      ],
    });

    expect(summary).toEqual({ scanned: 1, verified: 1, rejected: 0, failed: 0 });
    const onChain = (await store.get(detected.intentHash))?.evidence.onChain;
    expect(onChain).toMatchObject({ assetCode: 'XLM', assetIssuer: null, amount: '250.0000000' });
  });

  describe('rejections', () => {
    /** Runs the pass over one breach and returns it as stored afterwards, with the summary. */
    async function rejected(
      over: Partial<SlippageBreach>,
      deps: Parameters<typeof run>[0] = {}
    ): Promise<{ before: SlippageBreach; after: SlippageBreach; summary: unknown }> {
      const before = await breach(over);
      await store.create(before);
      const summary = await run(deps);
      return { before, after: (await store.get(before.intentHash))!, summary };
    }

    it('no_stellar_transaction: the breach names no transaction, and Horizon is not asked', async () => {
      const loadTransaction = vi.fn(async () => transaction());
      const { after, summary } = await rejected(
        { stellarTransactionId: null },
        { loadTransaction }
      );

      expect(summary).toEqual({ scanned: 1, verified: 0, rejected: 1, failed: 0 });
      expect(after.status).toBe('rejected');
      expect(after.rejectionReason).toBe('no_stellar_transaction');
      expect(loadTransaction).not.toHaveBeenCalled();
    });

    it('transaction_not_found: Horizon answers 404', async () => {
      const loadPayments = vi.fn(async () => [payment()]);
      const { after, summary } = await rejected(
        {},
        {
          loadTransaction: async () => {
            throw httpError(404);
          },
          loadPayments,
        }
      );

      expect(summary).toEqual({ scanned: 1, verified: 0, rejected: 1, failed: 0 });
      expect(after.rejectionReason).toBe('transaction_not_found');
      expect(loadPayments).not.toHaveBeenCalled();
    });

    it('transaction_failed: the transaction is on chain and did not succeed', async () => {
      const loadPayments = vi.fn(async () => [payment()]);
      const { after, summary } = await rejected(
        {},
        { loadTransaction: async () => transaction({ successful: false }), loadPayments }
      );

      expect(summary).toEqual({ scanned: 1, verified: 0, rejected: 1, failed: 0 });
      expect(after.rejectionReason).toBe('transaction_failed');
      expect(loadPayments).not.toHaveBeenCalled();
    });

    it.each([
      ['the transaction holds no payment', []],
      ['the only payment is from another account', [payment({ from: OTHER })]],
      ['the signer paid another asset', [payment({ asset_code: 'USDC' })]],
      ['the asset code is right and the issuer is not', [payment({ asset_issuer: OTHER })]],
      ['the operation is not a payment', [payment({ type: 'create_account' })]],
      ['the record has no type', [payment({ type: undefined })]],
      ['the record does not say where the money went', [payment({ to: undefined })]],
      ['the record has no amount', [payment({ amount: undefined })]],
    ])('payment_not_found: %s', async (_name, payments) => {
      const { after, summary } = await rejected({}, { loadPayments: async () => payments });

      expect(summary).toEqual({ scanned: 1, verified: 0, rejected: 1, failed: 0 });
      expect(after.rejectionReason).toBe('payment_not_found');
    });

    it('payment_not_found: the corridor is not in the registry, so it has no source asset', async () => {
      const { after } = await rejected({ corridor: 'usdc-zzz' });

      expect(after.status).toBe('rejected');
      expect(after.rejectionReason).toBe('payment_not_found');
    });

    it('keeps the evidence and its hash as they were, and records when it was decided', async () => {
      const { before, after } = await rejected({}, { loadPayments: async () => [] });

      expect(after.status).toBe('rejected');
      expect(after.evidence).toEqual(before.evidence);
      expect(after.evidence.onChain).toBeNull();
      expect(after.evidenceHash).toBe(before.evidenceHash);
      expect(after.verifiedAt).toBe(NOW.toISOString());
    });
  });

  describe('errors that may pass', () => {
    it.each([500, 503, 429])(
      'leaves the breach detected when Horizon answers %i for the transaction',
      async (status) => {
        const detected = await breach();
        await store.create(detected);

        const summary = await run({
          loadTransaction: async () => {
            throw httpError(status);
          },
        });

        expect(summary).toEqual({ scanned: 1, verified: 0, rejected: 0, failed: 1 });
        expect(await store.get(detected.intentHash)).toEqual(detected);
      }
    );

    it('leaves the breach detected when the request never reaches Horizon', async () => {
      const detected = await breach();
      await store.create(detected);

      const summary = await run({
        loadTransaction: async () => {
          throw new TypeError('fetch failed');
        },
      });

      expect(summary).toEqual({ scanned: 1, verified: 0, rejected: 0, failed: 1 });
      expect((await store.get(detected.intentHash))?.status).toBe('detected');
    });

    it('leaves the breach detected when the payments cannot be loaded', async () => {
      const detected = await breach();
      await store.create(detected);

      const summary = await run({
        loadPayments: async () => {
          throw new Error('Horizon payment lookup failed: HTTP 500');
        },
      });

      expect(summary).toEqual({ scanned: 1, verified: 0, rejected: 0, failed: 1 });
      expect(await store.get(detected.intentHash)).toEqual(detected);
    });

    it('counts a store that cannot be written as failed, and goes on to the next breach', async () => {
      const first = await breach();
      const second = await breach();
      await store.create(first);
      await store.create(second);
      // The newest breach is listed first: its write fails, the older one's does not.
      const flaky: SlippageBreachStore = {
        create: (record) => store.create(record),
        get: (hash) => store.get(hash),
        list: (filter) => store.list(filter),
        resolveVerification: async (hash, update) => {
          if (hash === second.intentHash) throw new Error('connection reset');
          return store.resolveVerification(hash, update);
        },
      };

      expect(await run({ store: flaky })).toEqual({
        scanned: 2,
        verified: 1,
        rejected: 0,
        failed: 1,
      });
      expect((await store.get(first.intentHash))?.status).toBe('verified');
      expect((await store.get(second.intentHash))?.status).toBe('detected');
    });

    it('tries a failed breach again on the next run', async () => {
      const detected = await breach();
      await store.create(detected);
      const loadTransaction = vi
        .fn<(hash: string) => Promise<HorizonTransactionRecord>>()
        .mockRejectedValueOnce(httpError(500))
        .mockResolvedValue(transaction());

      expect((await run({ loadTransaction })).failed).toBe(1);
      expect(await run({ loadTransaction })).toEqual({
        scanned: 1,
        verified: 1,
        rejected: 0,
        failed: 0,
      });
    });
  });

  it('resolves every kind in one run, and a second run scans nothing', async () => {
    const good = await breach();
    const noTx = await breach({ stellarTransactionId: null });
    const missing = await breach({ stellarTransactionId: 'c'.repeat(64) });
    const failedTx = await breach({ stellarTransactionId: 'd'.repeat(64) });
    const down = await breach({ stellarTransactionId: 'e'.repeat(64) });
    for (const record of [good, noTx, missing, failedTx, down]) await store.create(record);

    const loadTransaction = async (hash: string) => {
      if (hash === 'c'.repeat(64)) throw httpError(404);
      if (hash === 'e'.repeat(64)) throw httpError(500);
      return transaction({ hash, successful: hash !== 'd'.repeat(64) });
    };

    expect(await run({ loadTransaction })).toEqual({
      scanned: 5,
      verified: 1,
      rejected: 3,
      failed: 1,
    });
    expect((await store.get(good.intentHash))?.status).toBe('verified');
    expect((await store.get(noTx.intentHash))?.rejectionReason).toBe('no_stellar_transaction');
    expect((await store.get(missing.intentHash))?.rejectionReason).toBe('transaction_not_found');
    expect((await store.get(failedTx.intentHash))?.rejectionReason).toBe('transaction_failed');
    expect((await store.get(down.intentHash))?.status).toBe('detected');

    // Only the one Horizon could not answer for is left.
    expect(await run({ loadTransaction })).toEqual({
      scanned: 1,
      verified: 0,
      rejected: 0,
      failed: 1,
    });
    // And once that one resolves, nothing is.
    expect(await run()).toEqual({ scanned: 1, verified: 1, rejected: 0, failed: 0 });
    expect(await run()).toEqual({ scanned: 0, verified: 0, rejected: 0, failed: 0 });
  });

  it('looks at 50 breaches a run unless told otherwise, newest first', async () => {
    const created: SlippageBreach[] = [];
    for (let i = 0; i < 52; i += 1) {
      const record = await breach();
      created.push(record);
      await store.create(record);
    }

    expect((await run()).scanned).toBe(50);
    // The two oldest were beyond the limit and are still waiting.
    expect((await store.get(created[0]!.intentHash))?.status).toBe('detected');
    expect((await store.get(created[1]!.intentHash))?.status).toBe('detected');
    expect((await store.get(created[51]!.intentHash))?.status).toBe('verified');

    expect((await run({ limit: 1 })).scanned).toBe(1);
    expect((await run()).scanned).toBe(1);
  });

  it('does not count a breach somebody else resolved in between', async () => {
    const detected = await breach();
    await store.create(detected);
    const raced: SlippageBreachStore = {
      create: (record) => store.create(record),
      get: (hash) => store.get(hash),
      list: (filter) => store.list(filter),
      // What the store answers when the breach is no longer `detected`.
      resolveVerification: async () => null,
    };

    expect(await run({ store: raced })).toEqual({
      scanned: 1,
      verified: 0,
      rejected: 0,
      failed: 0,
    });
    expect(await run({ store: raced, loadPayments: async () => [] })).toEqual({
      scanned: 1,
      verified: 0,
      rejected: 0,
      failed: 0,
    });
  });

  it('lets a store that cannot list its breaches fail the run', async () => {
    const broken: SlippageBreachStore = {
      create: async () => true,
      get: async () => null,
      list: async () => {
        throw new Error('db down');
      },
      resolveVerification: async () => null,
    };

    await expect(run({ store: broken })).rejects.toThrow('db down');
  });
});

describe('fetchStellarTransaction (#2105)', () => {
  it('reads the transaction from Horizon by hash', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => transaction(),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchStellarTransaction(TX)).resolves.toMatchObject({
      hash: TX,
      ledger: 5_884_099,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(new RegExp(`/transactions/${TX}$`));
    vi.unstubAllGlobals();
  });

  it.each([404, 500])('throws an error carrying the status on HTTP %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status, json: async () => ({}) }))
    );

    await expect(fetchStellarTransaction(TX)).rejects.toMatchObject({ status });
    await expect(fetchStellarTransaction(TX)).rejects.toThrow(`HTTP ${status}`);
    vi.unstubAllGlobals();
  });

  it('does not let a hash walk out of the transactions path', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => transaction(),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchStellarTransaction('../accounts/GABC?x=1');
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/\/transactions\/[^/?]+$/);
    expect(url).not.toContain('/accounts/');
    vi.unstubAllGlobals();
  });
});
