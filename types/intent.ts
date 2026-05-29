import { z } from 'zod'

// ─── Off-ramp intent payload ───────────────────────────────────────────────────

/** The inner intent object that describes a single off-ramp operation. */
export const OfframpIntentSchema = z.object({
  anchorId: z.string().min(1, { message: 'anchorId is required' }),
  corridorId: z.string().min(1, { message: 'corridorId is required' }),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/, {
    message: 'amount must be a positive decimal with up to 7 decimal places',
  }),
  /** Stellar public key of the user initiating the off-ramp. */
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, {
    message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
  }),
})

export type OfframpIntent = z.infer<typeof OfframpIntentSchema>

// ─── SignedIntent envelope ─────────────────────────────────────────────────────

/**
 * Signed envelope that wraps an off-ramp intent for server verification.
 *
 * Construction:
 *   1. Canonicalize `intent` (keys sorted, JSON stringified).
 *   2. SHA-256 the canonical bytes → `hash` (hex).
 *   3. Ed25519-sign `hash` bytes with the user's Stellar private key → `signature` (base64).
 *   4. Include the matching Stellar `publicKey`.
 *
 * The server verifies the signature before routing the intent.
 */
export const SignedIntentEnvelopeSchema = z.object({
  intent: OfframpIntentSchema,
  /** Hex-encoded SHA-256 of the canonicalized intent JSON. */
  hash: z.string().regex(/^[0-9a-f]{64}$/, {
    message: 'hash must be a lowercase hex-encoded SHA-256 (64 chars)',
  }),
  /** Base64-encoded Ed25519 signature over the hash bytes. */
  signature: z.string().min(1, { message: 'signature is required' }),
  /** Stellar public key whose corresponding private key produced the signature. */
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, {
    message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
  }),
})

export type SignedIntentEnvelope = z.infer<typeof SignedIntentEnvelopeSchema>
