import { Keypair } from '@stellar/stellar-sdk';
import { hashIntent, type Intent } from './hash';

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

export type IntentAttestationResult =
  { ok: true; attested: boolean } | { ok: false; status: 400 | 401; message: string };

/**
 * Optional intent attestation for the off-ramp submit path.
 *
 * The request body MAY carry `signature` + `publicKey` (a Freighter-signed
 * envelope over the canonical intent hash). When present, the signature is
 * recomputed against `hashIntent(intent)` and a bad one is rejected (401); when
 * absent the intent is accepted unattested (`attested: false`) so unsigned
 * clients keep working. The two fields must be supplied together.
 *
 * `body` is read loosely on purpose: the intent's own schema (`IntentSchema`)
 * strips these fields, so they never contaminate the hashed intent — they are
 * only ever read here, off the raw body.
 */
export async function verifyOptionalIntentAttestation(
  body: unknown,
  intent: Intent
): Promise<IntentAttestationResult> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const signature = typeof raw.signature === 'string' ? raw.signature : undefined;
  const publicKey = typeof raw.publicKey === 'string' ? raw.publicKey : undefined;

  if (signature === undefined && publicKey === undefined) {
    return { ok: true, attested: false };
  }
  if (signature === undefined || publicKey === undefined) {
    return { ok: false, status: 400, message: 'signature and publicKey must be provided together' };
  }

  const intentHash = await hashIntent(intent);
  if (!verifyIntentSignature({ intentHash, publicKey, signature })) {
    return { ok: false, status: 401, message: 'Intent signature verification failed' };
  }
  return { ok: true, attested: true };
}
