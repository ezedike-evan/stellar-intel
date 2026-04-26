// @vitest-environment node

import {
  Account,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signChallenge, UserRejectedError } from '@/lib/stellar/sep10';

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
}));

const server = Keypair.fromSecret('SAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC5MY');
const user = Keypair.fromSecret('SABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNE7');

function buildChallengeXdr(networkPassphrase = Networks.PUBLIC): string {
  const transaction = new TransactionBuilder(new Account(server.publicKey(), '0'), {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(
      Operation.manageData({
        name: 'stellar.toml auth',
        value: 'test challenge',
      })
    )
    .setTimeout(300)
    .build();

  transaction.sign(server);
  return transaction.toXDR();
}

function signedByUser(signedXdr: string, networkPassphrase: string): boolean {
  const transaction = new Transaction(signedXdr, networkPassphrase);
  const transactionHash = transaction.hash();

  return transaction.signatures.some((signature) => {
    return user.verify(transactionHash, signature.signature());
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('signChallenge', () => {
  it('passes the SEP-1 network passphrase to Freighter and returns an envelope signed by the user', async () => {
    const freighter = await import('@stellar/freighter-api');
    const challengeXdr = buildChallengeXdr(Networks.PUBLIC);

    vi.mocked(freighter.signTransaction).mockImplementation(async (xdr, opts) => {
      const transaction = new Transaction(xdr, opts?.networkPassphrase ?? Networks.PUBLIC);
      transaction.sign(user);

      return {
        signedTxXdr: transaction.toXDR(),
        signerAddress: user.publicKey(),
      };
    });

    const signedXdr = await signChallenge(challengeXdr, Networks.PUBLIC, user.publicKey());

    expect(freighter.signTransaction).toHaveBeenCalledWith(challengeXdr, {
      networkPassphrase: Networks.PUBLIC,
      address: user.publicKey(),
    });
    expect(signedByUser(signedXdr, Networks.PUBLIC)).toBe(true);
  });

  it('maps Freighter user rejection to UserRejectedError', async () => {
    const freighter = await import('@stellar/freighter-api');
    const challengeXdr = buildChallengeXdr(Networks.PUBLIC);

    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: '',
      signerAddress: '',
      error: { code: -4, message: 'The user rejected this request.' },
    });

    await expect(
      signChallenge(challengeXdr, Networks.PUBLIC, user.publicKey())
    ).rejects.toBeInstanceOf(UserRejectedError);
  });
});
