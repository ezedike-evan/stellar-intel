/**
 * @vitest-environment node
 *
 * Issue #2211 (AGS018) — dryRun mode for intel.execute.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Account,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import { executeIntent, prepareIntent } from '@/lib/mcp/offramp';

const { submitTransaction, loadAccount } = vi.hoisted(() => ({
  submitTransaction: vi.fn(),
  loadAccount: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn().mockImplementation(function MockHorizonServer(this: {
        submitTransaction: typeof submitTransaction;
        loadAccount: typeof loadAccount;
      }) {
        this.submitTransaction = submitTransaction;
        this.loadAccount = loadAccount;
      }),
    },
  };
});

const COWRIE_ACCOUNT = Keypair.random().publicKey();

const validIntent = {
  type: 'offramp' as const,
  sourceAsset: 'NGNT',
  destinationAsset: 'NGN',
  amount: '100',
  recipient: 'recipient-123',
};

async function prepareAndSign(kp: Keypair, senderSeq = '0') {
  loadAccount.mockResolvedValueOnce({
    accountId: () => kp.publicKey(),
    sequenceNumber: () => senderSeq,
    incrementSequenceNumber: () => {},
  });

  const { unsignedEnvelope, unsignedTx } = await prepareIntent(
    { ...validIntent, sender: kp.publicKey() },
    loadAccount
  );

  const signature = Buffer.from(kp.sign(Buffer.from(unsignedEnvelope.intentHash, 'utf8'))).toString(
    'base64'
  );

  const tx = TransactionBuilder.fromXDR(unsignedTx, Networks.PUBLIC);
  tx.sign(kp);

  return { unsignedEnvelope, signature, signedTx: tx.toXDR(), tx };
}

describe('intel.execute dryRun (#2211)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ cowrie: COWRIE_ACCOUNT }));
  });

  it('dryRun: true returns status "verified" with matching hash and does not call submitTransaction', async () => {
    const kp = Keypair.random();
    const { unsignedEnvelope, signature, signedTx, tx } = await prepareAndSign(kp);

    const result = await executeIntent({
      unsignedEnvelope,
      signature,
      signedTx,
      dryRun: true,
    });

    expect(result).toEqual({
      status: 'verified',
      hash: Buffer.from(tx.hash()).toString('hex'),
      ledger: null,
      corridorId: 'ngnt-ngn',
      anchorId: 'cowrie',
    });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('dryRun: true with a wrong memo still throws TX_MISMATCH', async () => {
    const kp = Keypair.random();
    const { unsignedEnvelope, signature } = await prepareAndSign(kp);

    // Rebuild tx with wrong memo
    const wrongTx = new TransactionBuilder(new Account(kp.publicKey(), '0'), {
      fee: '100',
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(
        Operation.payment({
          destination: COWRIE_ACCOUNT,
          asset: (await import('@stellar/stellar-sdk')).Asset.native(),
          amount: '100',
        })
      )
      .addMemo(Memo.hash(Buffer.alloc(32, 1).toString('hex')))
      .setTimeout(300)
      .build();
    wrongTx.sign(kp);

    await expect(
      executeIntent({
        unsignedEnvelope,
        signature,
        signedTx: wrongTx.toXDR(),
        dryRun: true,
      })
    ).rejects.toMatchObject({ code: 'TX_MISMATCH' });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('dryRun: true with an over-limit fee is still rejected', async () => {
    const kp = Keypair.random();
    const { unsignedEnvelope, signature, tx } = await prepareAndSign(kp);

    const payment = (tx as Transaction).operations[0] as Operation.Payment;
    const highFeeTx = new TransactionBuilder(new Account(kp.publicKey(), '0'), {
      fee: '200000', // exceeds MAX_FEE_STROOPS (100_000)
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(
        Operation.payment({
          destination: payment.destination,
          asset: payment.asset,
          amount: payment.amount,
        })
      )
      .addMemo(Memo.hash(Buffer.from(unsignedEnvelope.intentHash, 'hex')))
      .setTimeout(300)
      .build();
    highFeeTx.sign(kp);

    await expect(
      executeIntent({
        unsignedEnvelope,
        signature,
        signedTx: highFeeTx.toXDR(),
        dryRun: true,
      })
    ).rejects.toMatchObject({ code: 'TX_MISMATCH' });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('dryRun omitted still submits to Horizon', async () => {
    const kp = Keypair.random();
    const { unsignedEnvelope, signature, signedTx, tx } = await prepareAndSign(kp);

    submitTransaction.mockResolvedValueOnce({
      hash: Buffer.from(tx.hash()).toString('hex'),
      ledger: 4242,
    });

    const result = await executeIntent({
      unsignedEnvelope,
      signature,
      signedTx,
    });

    expect(result.status).toBe('submitted');
    expect(result.ledger).toBe(4242);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});
