import { Keypair } from '@stellar/stellar-sdk';

/**
 * Verify an Ed25519 signature over an intent hash.
 *
 * Matches the envelope produced by `lib/intent/sign.ts` (`signIntent`) and the
 * dispute proof: the signature is a base64 string over the raw bytes of the
 * hex-encoded `intentHash`, checked against the signer's Stellar public key.
 *
 * Returns false on any malformed input (bad key, non-hex hash, bad base64)
 * rather than throwing, so callers can treat a false result as "reject".
 */
export function verifyIntentSignature(params: {
  intentHash: string;
  publicKey: string;
  signature: string;
}): boolean {
  try {
    const keypair = Keypair.fromPublicKey(params.publicKey);
    const messageBytes = Buffer.from(params.intentHash, 'hex');
    const sigBytes = Buffer.from(params.signature, 'base64');
    if (messageBytes.length === 0 || sigBytes.length === 0) return false;
    return keypair.verify(messageBytes, sigBytes);
  } catch {
    return false;
  }
}
