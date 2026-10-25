import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account } from '@stellar/stellar-sdk';
import { fetchAccount, buildWithdrawPayment, checkDepositPreflight } from '@/lib/stellar/horizon';
import { horizonServer } from '@/lib/stellar/horizon';

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
  getNetwork: vi.fn(async () => ({ error: false, network: '', networkPassphrase: '' })),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

// Valid Stellar public keys generated via Keypair.random()
const SOURCE_KEY = 'GAI2X6XPCRM47DBZTMNQQHTFDR6E4LNY7XQDJ7T6GJL3DPEEQB3HSNVB';
const ANCHOR_ACCOUNT = 'GBGNTATIEI4PBPLLX4QPIWDQZSOF6XUVJAVWEWRP7MGPOOTD53SMAWT2';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// Use a real Account instance so TransactionBuilder.build() works correctly
const mockAccount = new Account(SOURCE_KEY, '1000') as unknown as Awaited<
  ReturnType<typeof horizonServer.loadAccount>
>;

describe('fetchAccount', () => {
  it('throws a clear error when Horizon returns 404', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockRejectedValue({
      response: { status: 404 },
    });

    await expect(fetchAccount(SOURCE_KEY)).rejects.toThrow(
      'Account does not exist on the Stellar network'
    );
  });
});

describe('checkDepositPreflight (#1462)', () => {
  const USDC = { code: 'USDC', issuer: USDC_ISSUER };

  /** An account response reduced to the field the preflight reads. */
  const accountWith = (balances: unknown[]) =>
    ({ balances }) as unknown as Awaited<ReturnType<typeof horizonServer.loadAccount>>;

  const usdcLine = (extra: Record<string, unknown> = {}) => ({
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: USDC_ISSUER,
    balance: '42.5000000',
    is_authorized: true,
    ...extra,
  });
  const nativeLine = { asset_type: 'native', balance: '10.0000000' };

  it('reports a missing account (Horizon 404) without throwing', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockRejectedValue({ response: { status: 404 } });

    await expect(checkDepositPreflight(SOURCE_KEY, USDC)).resolves.toEqual({
      accountExists: false,
      hasTrustline: false,
      trustlineAuthorized: null,
      balance: null,
    });
  });

  it('lets any other error propagate', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockRejectedValue({ response: { status: 503 } });

    await expect(checkDepositPreflight(SOURCE_KEY, USDC)).rejects.toEqual({
      response: { status: 503 },
    });
  });

  it('finds the trustline and its balance', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(accountWith([nativeLine, usdcLine()]));

    await expect(checkDepositPreflight(SOURCE_KEY, USDC)).resolves.toEqual({
      accountExists: true,
      hasTrustline: true,
      trustlineAuthorized: true,
      balance: '42.5000000',
    });
  });

  it('reports an existing account with no trustline for the asset', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(accountWith([nativeLine]));

    await expect(checkDepositPreflight(SOURCE_KEY, USDC)).resolves.toEqual({
      accountExists: true,
      hasTrustline: false,
      trustlineAuthorized: null,
      balance: null,
    });
  });

  it('does not match a trustline for the same code from a different issuer', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(
      accountWith([usdcLine({ asset_issuer: ANCHOR_ACCOUNT })])
    );

    const result = await checkDepositPreflight(SOURCE_KEY, USDC);
    expect(result.hasTrustline).toBe(false);
  });

  it('reports a trustline the issuer has not authorized', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(
      accountWith([usdcLine({ is_authorized: false })])
    );

    const result = await checkDepositPreflight(SOURCE_KEY, USDC);
    expect(result.hasTrustline).toBe(true);
    expect(result.trustlineAuthorized).toBe(false);
  });

  it('leaves trustlineAuthorized null when Horizon omits is_authorized', async () => {
    const { is_authorized: _omit, ...withoutFlag } = usdcLine();
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(accountWith([withoutFlag]));

    const result = await checkDepositPreflight(SOURCE_KEY, USDC);
    expect(result.hasTrustline).toBe(true);
    expect(result.trustlineAuthorized).toBeNull();
  });

  it('always reports a trustline for XLM, and its balance', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(accountWith([nativeLine]));

    await expect(checkDepositPreflight(SOURCE_KEY, { code: 'XLM', issuer: '' })).resolves.toEqual({
      accountExists: true,
      hasTrustline: true,
      trustlineAuthorized: null,
      balance: '10.0000000',
    });
  });

  it('is asset-generic: it finds a non-USDC line', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(
      accountWith([usdcLine({ asset_code: 'NGNC', balance: '7.0000000' })])
    );

    const result = await checkDepositPreflight(SOURCE_KEY, { code: 'NGNC', issuer: USDC_ISSUER });
    expect(result).toMatchObject({ hasTrustline: true, balance: '7.0000000' });
  });
});

describe('buildWithdrawPayment', () => {
  beforeEach(() => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(mockAccount);
    vi.spyOn(horizonServer, 'fetchBaseFee').mockResolvedValue(100);
  });

  it('builds a transaction with exactly one payment operation', async () => {
    const tx = await buildWithdrawPayment({
      sourcePublicKey: SOURCE_KEY,
      anchorAccount: ANCHOR_ACCOUNT,
      amount: '100',
      memo: 'test-memo',
      memoType: 'text',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
    });

    expect(tx?.operations).toHaveLength(1);
    expect(tx?.operations?.[0]?.type).toBe('payment');
  });

  it('applies the memo field to the built transaction', async () => {
    const tx = await buildWithdrawPayment({
      sourcePublicKey: SOURCE_KEY,
      anchorAccount: ANCHOR_ACCOUNT,
      amount: '100',
      memo: 'abc123',
      memoType: 'text',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
    });

    // sdk 17 exposes a text memo's value as a Uint8Array rather than a string.
    expect(Buffer.from(tx.memo.value as Uint8Array).toString('utf8')).toBe('abc123');
  });

  it('uses the correct USDC asset code and issuer', async () => {
    const tx = await buildWithdrawPayment({
      sourcePublicKey: SOURCE_KEY,
      anchorAccount: ANCHOR_ACCOUNT,
      amount: '100',
      memo: '',
      memoType: 'text',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
    });

    const op = tx.operations[0] as any;
    expect(op?.asset?.code).toBe('USDC');
    expect(op?.asset?.issuer).toBe(USDC_ISSUER);
  });

  it('returns correctly parsed operations for native XLM', async () => {
    const tx = await buildWithdrawPayment({
      sourcePublicKey: SOURCE_KEY,
      anchorAccount: ANCHOR_ACCOUNT,
      amount: '10',
      memo: 'memo-abc',
      memoType: 'text',
      assetCode: 'XLM',
      assetIssuer: '',
    });

    const op = tx.operations[0] as any;
    // The JS SDK might set it to Asset('XLM', undefined) or Native
    expect(op?.asset?.isNative?.() || op?.asset?.code === 'XLM').toBe(true);
  });

  it('extracts result_codes into a readable message on Horizon submit error', async () => {
    const { signAndSubmitPayment } = await import('@/lib/stellar/horizon');
    const freighter = await import('@stellar/freighter-api');

    const tx = await buildWithdrawPayment({
      sourcePublicKey: SOURCE_KEY,
      anchorAccount: ANCHOR_ACCOUNT,
      amount: '100',
      memo: '',
      memoType: 'text',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
    });

    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: tx.toXDR(),
      signerAddress: SOURCE_KEY,
    });

    vi.spyOn(horizonServer, 'submitTransaction').mockRejectedValue({
      response: {
        data: {
          extras: {
            result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] },
          },
        },
      },
    });

    await expect(signAndSubmitPayment(tx)).rejects.toThrow(/tx_failed|op_underfunded/);
  });
});

describe('verifyAssetOnChain', () => {
  it('returns true when Horizon returns matching asset records', async () => {
    const { verifyAssetOnChain } = await import('@/lib/stellar/horizon');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          _embedded: {
            records: [{ asset_code: 'USDC', asset_issuer: USDC_ISSUER }],
          },
        }),
      }))
    );

    const result = await verifyAssetOnChain('USDC', USDC_ISSUER);
    expect(result).toBe(true);
  });

  it('returns false when Horizon returns empty records (unissued/unknown)', async () => {
    const { verifyAssetOnChain } = await import('@/lib/stellar/horizon');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          _embedded: {
            records: [],
          },
        }),
      }))
    );

    const result = await verifyAssetOnChain('USDC', 'GBOGUSISSUER');
    expect(result).toBe(false);
  });

  it('returns false when Horizon returns HTTP 400/404', async () => {
    const { verifyAssetOnChain } = await import('@/lib/stellar/horizon');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
      }))
    );

    const result = await verifyAssetOnChain('USDC', 'invalid-key');
    expect(result).toBe(false);
  });

  it('throws when Horizon returns HTTP 500/503 server error', async () => {
    const { verifyAssetOnChain } = await import('@/lib/stellar/horizon');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
      }))
    );

    await expect(verifyAssetOnChain('USDC', USDC_ISSUER)).rejects.toThrow(
      'Horizon /assets returned HTTP 503'
    );
  });
});
