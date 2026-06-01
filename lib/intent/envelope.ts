import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { SignedIntentEnvelope, OfframpIntent } from '@/types/intent';

// ─── Canonicalization ─────────────────────────────────────────────────────────

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)])
    );
  }
  return value;
}

/**
 * Produces a deterministic JSON string from an intent object.
 * Keys are sorted recursively so the same intent always hashes to the same
 * bytes regardless of insertion order or nesting depth.
 */
function canonicalize(intent: OfframpIntent): string {
  return JSON.stringify(sortKeys(intent));
}

// ─── Build (client-side, Freighter) ──────────────────────────────────────────

/**
 * Creates a signed envelope from an off-ramp intent using the user's Freighter
 * wallet. The private key never leaves the extension.
 *
 * Steps:
 *   1. Canonicalize intent (sorted keys, recursively → JSON).
 *   2. SHA-256 hash via Web Crypto API (browser-compatible).
 *   3. Ed25519-sign the canonical string via Freighter signMessage.
 *   4. Return the assembled envelope.
 */
export async function buildEnvelope(intent: OfframpIntent): Promise<SignedIntentEnvelope> {
  const canonical = canonicalize(intent);

  // Hash using the Web Crypto API — works in browser and Node.js 20+.
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Sign the canonical JSON via Freighter — private key stays in the extension.
  const { signMessage } = await import('@stellar/freighter-api');
  const result = await signMessage(canonical);

  if (result.error) {
    throw new Error(`Freighter signing failed: ${result.error.message}`);
  }
  if (!result.signedMessage) {
    throw new Error('Freighter returned an empty signature');
  }

  const sigBytes =
    typeof result.signedMessage === 'string'
      ? Buffer.from(result.signedMessage, 'base64')
      : Buffer.from(result.signedMessage);

  return {
    intent,
    hash,
    signature: sigBytes.toString('base64'),
    publicKey: result.signerAddress,
  };
}

// ─── Verify (server-side) ────────────────────────────────────────────────────

/**
 * Verifies a signed envelope on the server. Returns `true` only when:
 *   - envelope.publicKey matches intent.publicKey (prevents key substitution).
 *   - The hash field matches the SHA-256 of the canonicalized intent.
 *   - The signature is a valid Ed25519 signature over the canonical JSON bytes.
 *
 * Any error (bad key, malformed base64, key mismatch) returns `false` rather
 * than throwing so callers produce a clean 401 without a stack trace leak.
 */
export function verifyEnvelope(envelope: SignedIntentEnvelope): boolean {
  try {
    // Prevent key substitution: the signing key must be the intent's publicKey.
    if (envelope.publicKey !== envelope.intent.publicKey) return false;

    const canonical = canonicalize(envelope.intent);

    // Verify the hash field matches the re-derived hash.
    const hashBytes = createHash('sha256').update(canonical).digest();
    if (hashBytes.toString('hex') !== envelope.hash) return false;

    // Verify the Ed25519 signature over the canonical JSON bytes —
    // matching what Freighter signs via signMessage(canonical).
    const kp = Keypair.fromPublicKey(envelope.publicKey);
    const sigBytes = Buffer.from(envelope.signature, 'base64');

    return kp.verify(Buffer.from(canonical, 'utf8'), sigBytes);
  } catch {
    return false;
  }
}
