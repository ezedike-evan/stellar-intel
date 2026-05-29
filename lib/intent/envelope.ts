import { createHash } from 'crypto'
import { Keypair } from '@stellar/stellar-sdk'
import type { SignedIntentEnvelope, OfframpIntent } from '@/types/intent'

// ─── Canonicalization ─────────────────────────────────────────────────────────

/**
 * Produces a deterministic JSON string from an intent object.
 * Top-level keys are sorted alphabetically so the same intent always hashes
 * to the same bytes regardless of insertion order.
 */
function canonicalize(intent: OfframpIntent): string {
  const sorted = Object.fromEntries(
    Object.entries(intent).sort(([a], [b]) => a.localeCompare(b))
  )
  return JSON.stringify(sorted)
}

// ─── Build (client-side) ─────────────────────────────────────────────────────

/**
 * Creates a signed envelope from an off-ramp intent using the caller's Stellar
 * keypair. Call this on the client before POSTing to `/api/intent/offramp`.
 *
 * Steps:
 *   1. Canonicalize intent (sorted keys → JSON).
 *   2. SHA-256 hash the canonical bytes.
 *   3. Ed25519 sign the hash bytes with `keypair`.
 *   4. Return the assembled envelope.
 */
export function buildEnvelope(intent: OfframpIntent, keypair: Keypair): SignedIntentEnvelope {
  const canonical = canonicalize(intent)
  const hashBytes = createHash('sha256').update(canonical).digest()

  return {
    intent,
    hash: hashBytes.toString('hex'),
    signature: Buffer.from(keypair.sign(hashBytes)).toString('base64'),
    publicKey: keypair.publicKey(),
  }
}

// ─── Verify (server-side) ────────────────────────────────────────────────────

/**
 * Verifies a signed envelope on the server. Returns `true` only when:
 *   - The hash field matches the SHA-256 of the canonicalized intent.
 *   - The signature is a valid Ed25519 signature over the hash bytes by publicKey.
 *
 * Any error (bad key, malformed base64, wrong network) returns `false` rather
 * than throwing so callers can produce a clean 401 without a stack trace leak.
 */
export function verifyEnvelope(envelope: SignedIntentEnvelope): boolean {
  try {
    const canonical = canonicalize(envelope.intent)
    const hashBytes = createHash('sha256').update(canonical).digest()

    if (hashBytes.toString('hex') !== envelope.hash) return false

    const kp = Keypair.fromPublicKey(envelope.publicKey)
    const sigBytes = Buffer.from(envelope.signature, 'base64')

    return kp.verify(hashBytes, sigBytes)
  } catch {
    return false
  }
}
