import type { Intent } from './hash';
import { hashIntent } from './hash';

export interface SignedIntentEnvelope {
  intentHash: string;
  signature: string;
  publicKey: string;
}

export class IntentSignError extends Error {
  constructor(
    message: string,
    public readonly code: 'FREIGHTER_UNAVAILABLE' | 'SIGN_REJECTED' | 'SIGN_FAILED'
  ) {
    super(message);
    this.name = 'IntentSignError';
  }
}

/**
 * Freighter's v4+ API returns the signature as a base64 string; the older v3
 * shape returns raw bytes. Normalize both to base64, which is what the server
 * verifier (`lib/intent/verify.ts`) decodes.
 */
function toBase64Signature(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) {
    let binary = '';
    for (const byte of value) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return '';
}

/**
 * Sign an intent hash using Freighter's signMessage API.
 * Returns the intent hash, Freighter's base64 signature, and the signer's public key.
 */
export async function signIntent(intent: Intent): Promise<SignedIntentEnvelope> {
  const { signMessage, getAddress } = await import('@stellar/freighter-api').catch(() => {
    throw new IntentSignError('Freighter extension is not available', 'FREIGHTER_UNAVAILABLE');
  });

  const intentHash = await hashIntent(intent);

  const signResult = await signMessage(intentHash).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Sign request failed';
    throw new IntentSignError(msg, 'SIGN_FAILED');
  });

  if ('error' in signResult && signResult.error) {
    const msg = String(signResult.error);
    const code = msg.toLowerCase().includes('reject') ? 'SIGN_REJECTED' : 'SIGN_FAILED';
    throw new IntentSignError(msg, code);
  }

  const addrResult = await getAddress().catch(() => {
    throw new IntentSignError(
      'Could not retrieve public key from Freighter',
      'FREIGHTER_UNAVAILABLE'
    );
  });

  const addr = addrResult as { address?: string; publicKey?: string; error?: string };
  const publicKey = addr.address ?? addr.publicKey ?? '';

  if (!publicKey) {
    throw new IntentSignError('Freighter returned no public key', 'FREIGHTER_UNAVAILABLE');
  }

  const sig = signResult as { signedMessage?: unknown; signature?: unknown };
  const signature = toBase64Signature(sig.signedMessage ?? sig.signature);

  if (!signature) {
    throw new IntentSignError('Freighter returned no signature', 'SIGN_FAILED');
  }

  return { intentHash, signature, publicKey };
}
