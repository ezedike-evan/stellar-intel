import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildIntentCommitmentTx } from '@/lib/stellar/tx-builder';
import { horizonServer, fetchAccount } from '@/lib/stellar/horizon';

vi.mock('@/lib/stellar/horizon', () => ({
  horizonServer: {
    fetchBaseFee: vi.fn().mockResolvedValue(100),
  },
  fetchAccount: vi.fn().mockResolvedValue({
    id: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    accountId: () => 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    sequenceNumber: () => '100',
    incrementSequenceNumber: vi.fn(),
  }),
}));

describe('buildIntentCommitmentTx', () => {
  const mockParams = {
    sourcePublicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    anchorAccount: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount: '100.50',
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    intentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // 32 byte hex
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a valid transaction with payment and memohash', async () => {
    const tx = await buildIntentCommitmentTx(mockParams);

    expect(tx.timeBounds?.minTime).toBe('0');
    expect(tx.timeBounds?.maxTime).toBe(mockParams.deadline.toString());

    expect(tx.memo.type).toBe('hash');
    expect(tx.memo.value).toBeInstanceOf(Buffer);
    expect((tx.memo.value as Buffer).toString('hex')).toBe(mockParams.intentHash);

    expect(tx.operations.length).toBe(1);
    const op = tx.operations[0] as any;
    expect(op.type).toBe('payment');
    expect(op.destination).toBe(mockParams.anchorAccount);
    expect(parseFloat(op.amount)).toBe(parseFloat(mockParams.amount));
    expect(op.asset.code).toBe(mockParams.assetCode);
    expect(op.asset.issuer).toBe(mockParams.assetIssuer);
  });

  it('handles horizon server fetchBaseFee failure and falls back to default fee', async () => {
    vi.mocked(horizonServer.fetchBaseFee).mockRejectedValueOnce(new Error('Network error'));

    const tx = await buildIntentCommitmentTx(mockParams);

    expect(tx.fee).toBe('100'); // Default BASE_FEE in stellar-sdk is 100
  });
});
