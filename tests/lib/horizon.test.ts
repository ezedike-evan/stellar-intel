import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account } from '@stellar/stellar-sdk';
import { fetchAccount, buildWithdrawPayment } from '@/lib/stellar/horizon';
import { horizonServer } from '@/lib/stellar/horizon';

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
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

    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]!.type).toBe('payment');
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

    expect(tx.memo.value).toBe('abc123');
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

    const op = tx.operations[0] as { asset: { code: string; issuer: string } };
    expect(op.asset.code).toBe('USDC');
    expect(op.asset.issuer).toBe(USDC_ISSUER);
  });

  it('extracts result_codes into a readable message on Horizon submit error', async () => {
    const { signAndSubmitPayment } = await import('@/lib/stellar/horizon');
    const freighter = await import('@stellar/freighter-api');

    // Build a real transaction so we have valid XDR to sign
    const tx = await buildWithdrawPayment({
      sourcePublicKey: SOURCE_KEY,
      anchorAccount: ANCHOR_ACCOUNT,
      amount: '100',
      memo: '',
      memoType: 'text',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
    });

    // Return the same XDR as the "signed" result so fromXDR can parse it
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
