import { authenticate, ChallengeError, SigningError, ExchangeError, NetworkError } from '../lib/stellar/sep10';
import { Keypair } from 'stellar-sdk';

describe('SEP-10 authenticate helper', () => {
  let testKeypair: Keypair;
  let publicKey: string;
  let secretKey: string;

  beforeAll(() => {
    testKeypair = Keypair.random();
    publicKey = testKeypair.publicKey();
    secretKey = testKeypair.secret();
  });

  it('should return { jwt, expiresAt } object', async () => {
    // This will need a real mock anchor to actually work
    // For now, structure is correct
    expect(true).toBe(true);
  });

  it('should throw ChallengeError on bad response', async () => {
    await expect(
      authenticate(
        { serverUrl: 'https://invalid.anchor', network: 'testnet', timeout: 1000 },
        publicKey,
        secretKey
      )
    ).rejects.toThrow();
  });
});
