import { z } from 'zod';

// ─── Off-ramp intent payload ───────────────────────────────────────────────────

/** The inner intent object that describes a single off-ramp operation. */
export const OfframpIntentSchema = z.object({
  anchorId: z.string().min(1, { message: 'anchorId is required' }),
  corridorId: z.string().min(1, { message: 'corridorId is required' }),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, {
      message: 'amount must be a positive decimal with up to 7 decimal places',
    })
    .refine((val: string) => parseFloat(val) > 0, { message: 'amount must be greater than zero' }),
  /** Stellar public key of the user initiating the off-ramp. */
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, {
    message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
  }),
});

export type OfframpIntent = z.infer<typeof OfframpIntentSchema>;

// ─── SignedIntent envelope ─────────────────────────────────────────────────────

/**
 * Signed envelope that wraps an off-ramp intent for server verification.
 *
 * Construction:
 *   1. Canonicalize `intent` (keys sorted recursively, JSON stringified).
 *   2. SHA-256 the canonical bytes → `hash` (hex).
 *   3. Ed25519-sign the canonical JSON bytes via Freighter → `signature` (base64).
 *   4. Include the matching Stellar `publicKey` (returned by Freighter).
 *
 * The server verifies the signature before routing the intent.
 */
export const SignedIntentEnvelopeSchema = z
  .object({
    intent: OfframpIntentSchema,
    /** Hex-encoded SHA-256 of the canonicalized intent JSON. */
    hash: z.string().regex(/^[0-9a-f]{64}$/, {
      message: 'hash must be a lowercase hex-encoded SHA-256 (64 chars)',
    }),
    /** Base64-encoded Ed25519 signature over the canonical intent JSON bytes. */
    signature: z.string().min(1, { message: 'signature is required' }),
    /** Stellar public key whose corresponding private key produced the signature. */
    publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, {
      message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
    }),
  })
  .refine((data) => data.publicKey === data.intent.publicKey, {
    message: 'envelope publicKey must match intent publicKey',
    path: ['publicKey'],
  });

export type SignedIntentEnvelope = z.infer<typeof SignedIntentEnvelopeSchema>;

// ─── v1 Intent (canonical router primitive) ───────────────────────────────────

/**
 * Zod schema for the v1 canonical Intent — the 1000x primitive shared across
 * the router, API, and SDK. All fields are validated at runtime; `metadata`
 * is an optional free-form record for extension without schema churn.
 */
export const IntentV1Schema = z.object({
  /** Unique identifier for this intent (UUID or similar). */
  id: z.string().min(1, { message: 'id is required' }),
  /** Source asset identifier (e.g. "stellar:USDC:GA5..." or asset code). */
  from: z.string().min(1, { message: 'from is required' }),
  /** Destination asset or fiat identifier (e.g. "iso4217:NGN"). */
  to: z.string().min(1, { message: 'to is required' }),
  /** Exact sell amount as a positive decimal string. */
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, { message: 'amount must be a non-negative decimal string' })
    .refine((v) => parseFloat(v) > 0, { message: 'amount must be greater than zero' }),
  /** Minimum acceptable received amount (floor) as a decimal string. */
  floor: z
    .string()
    .regex(/^\d+(\.\d+)?$/, { message: 'floor must be a non-negative decimal string' })
    .refine((v) => parseFloat(v) >= 0, { message: 'floor must be >= 0' }),
  /** RFC 3339 timestamp after which the intent must not be executed. */
  deadline: z.iso.datetime({ message: 'deadline must be an RFC 3339 datetime string' }),
  /** Destination address or account for the payout. */
  recipient: z.string().min(1, { message: 'recipient is required' }),
  /** 128-bit random hex string for replay protection. */
  nonce: z
    .string()
    .regex(/^[0-9a-f]{32}$/i, { message: 'nonce must be a 32-char hex string (128-bit)' }),
  /** Optional free-form extension data. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type IntentV1 = z.infer<typeof IntentV1Schema>;
