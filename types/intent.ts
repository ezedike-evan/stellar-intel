import { z } from 'zod';
import { AMOUNT_PATTERN, STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';

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

// ─── Canonical Intent V1 (versioned superset) ─────────────────────────────────

const intentAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, { message: 'amount must be a positive decimal with up to 7 dp' })
  .refine((v) => parseFloat(v) > 0, { message: 'amount must be greater than zero' });

const intentBaseSchema = z.object({
  schemaVersion: z.literal(1).default(1 as const),
  sourceAsset: z.string().min(1, { message: 'sourceAsset is required' }),
  destinationAsset: z.string().min(1, { message: 'destinationAsset is required' }),
  amount: intentAmountSchema,
  sender: z.string().min(1, { message: 'sender is required' }),
  recipient: z.string().min(1, { message: 'recipient is required' }),
});

export const IntentHopAssetSchema = z.object({
  code: z.string().min(1, { message: 'asset code is required' }),
  issuer: z.string().optional(),
});
export type IntentHopAsset = z.infer<typeof IntentHopAssetSchema>;

export const IntentHopSchema = z.object({
  kind: z.enum(['on-ramp', 'swap', 'yield']),
  sellAsset: IntentHopAssetSchema,
  buyAsset: IntentHopAssetSchema,
  minReceive: z.string().min(1, { message: 'minReceive is required' }),
});
export type IntentHop = z.infer<typeof IntentHopSchema>;

export const IntentScheduleSchema = z.object({
  /** POSIX cron expression (5 fields). */
  cron: z.string().min(1, { message: 'cron expression is required' }),
  /** Maximum number of executions before the schedule is cancelled. */
  count: z.number().int().positive().optional(),
  /** RFC 3339 timestamp after which no further executions are triggered. */
  until: z.iso.datetime().optional(),
});
export type IntentSchedule = z.infer<typeof IntentScheduleSchema>;

export const OfframpIntentV1Schema = intentBaseSchema.extend({
  kind: z.literal('offramp'),
});
export type OfframpIntentV1 = z.infer<typeof OfframpIntentV1Schema>;

export const ChainedIntentV1Schema = intentBaseSchema.extend({
  kind: z.literal('chained'),
  hops: z.array(IntentHopSchema).min(2, { message: 'chained intent requires at least 2 hops' }),
});
export type ChainedIntentV1 = z.infer<typeof ChainedIntentV1Schema>;

export const RecurringIntentV1Schema = intentBaseSchema.extend({
  kind: z.literal('recurring'),
  schedule: IntentScheduleSchema,
});
export type RecurringIntentV1 = z.infer<typeof RecurringIntentV1Schema>;

/** Versioned discriminated union covering all supported intent kinds. */
export const CanonicalIntentV1Schema = z.discriminatedUnion('kind', [
  OfframpIntentV1Schema,
  ChainedIntentV1Schema,
  RecurringIntentV1Schema,
]);
export type CanonicalIntentV1 = z.infer<typeof CanonicalIntentV1Schema>;

// ─── On-ramp intent payload ────────────────────────────────────────────────────

/**
 * Rails a user can fund a deposit from. Mirrors the SEP-24 deposit `type`
 * parameter; the off-ramp equivalent is never carried on the intent because the
 * anchor derives it from the payout `recipient`.
 */
export const ONRAMP_DEPOSIT_METHODS = ['bank_transfer', 'cash', 'mobile_money', 'card'] as const;
export const OnrampDepositMethodSchema = z.enum(ONRAMP_DEPOSIT_METHODS);
export type OnrampDepositMethod = (typeof ONRAMP_DEPOSIT_METHODS)[number];

/** Stellar memo kinds an anchor may require to attribute an incoming deposit. */
export const ONRAMP_MEMO_TYPES = ['text', 'id', 'hash'] as const;
export const OnrampMemoTypeSchema = z.enum(ONRAMP_MEMO_TYPES);
export type OnrampMemoType = (typeof ONRAMP_MEMO_TYPES)[number];

/** Largest value a Stellar `id` memo can carry (uint64). */
const MAX_ID_MEMO = 18_446_744_073_709_551_615n;

/**
 * The inner intent object that describes a single on-ramp (deposit) operation.
 *
 * Mirrors the off-ramp intent (`lib/intent/offramp.ts`) wherever the two
 * directions genuinely agree — `type`, `sourceAsset`, `destinationAsset`,
 * `amount`, `sender` — and diverges where a deposit is not simply a withdrawal
 * run backwards:
 *
 *  - `sourceAsset` is the fiat currency being paid in and `destinationAsset`
 *    the Stellar asset being bought. The off-ramp pair reads the other way.
 *  - `destination` replaces the off-ramp's free-form `recipient`. A deposit
 *    always settles into a Stellar account, so it is validated as a strkey
 *    instead of an opaque bank-account string.
 *  - `depositMethod` names the funding rail. Withdrawals carry no equivalent.
 *  - `memo`/`memoType` are deposit-only: anchors that credit a pooled account
 *    need a memo to attribute the incoming payment to this intent.
 */
export const OnrampIntentSchema = z
  .object({
    type: z.literal('onramp'),
    /** Fiat currency paid in, e.g. `NGN`. */
    sourceAsset: z.string().min(1, { message: 'sourceAsset is required' }),
    /** Stellar asset bought, e.g. `USDC`. */
    destinationAsset: z.string().min(1, { message: 'destinationAsset is required' }),
    /** Amount of `sourceAsset` to spend, as a positive decimal string. */
    amount: z
      .string()
      .regex(AMOUNT_PATTERN, { message: 'amount must be a positive decimal string' })
      .refine((v) => parseFloat(v) > 0, { message: 'amount must be greater than zero' }),
    /**
     * Reference for the payer on the fiat rail (bank account, wallet handle,
     * cash-agent id). Unlike the off-ramp `sender` this is not a Stellar
     * account, so it stays free-form.
     */
    sender: z.string().min(1, { message: 'sender is required' }),
    /** Stellar account credited when the deposit completes. */
    destination: z.string().regex(STELLAR_PUBKEY_PATTERN, {
      message: 'destination must be a valid Stellar public key (G…, 56 chars)',
    }),
    /** How the user funds the deposit. */
    depositMethod: OnrampDepositMethodSchema,
    /** Memo attributing the incoming payment; required by pooled-account anchors. */
    memo: z.string().min(1, { message: 'memo must not be empty' }).optional(),
    /** Kind of `memo`. Must be supplied together with `memo`. */
    memoType: OnrampMemoTypeSchema.optional(),
  })
  .superRefine((intent, ctx) => {
    if (intent.memo !== undefined && intent.memoType === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['memoType'],
        message: 'memoType is required when memo is present',
      });
      return;
    }

    if (intent.memoType !== undefined && intent.memo === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['memo'],
        message: 'memo is required when memoType is present',
      });
      return;
    }

    if (intent.memo === undefined || intent.memoType === undefined) return;

    // A memo the anchor cannot encode fails at payment time, long after the
    // intent was accepted — so reject it here, while it is still cheap.
    if (intent.memoType === 'text' && new TextEncoder().encode(intent.memo).length > 28) {
      ctx.addIssue({
        code: 'custom',
        path: ['memo'],
        message: 'a text memo must be at most 28 bytes when UTF-8 encoded',
      });
    }

    if (
      intent.memoType === 'id' &&
      (!/^\d+$/.test(intent.memo) || BigInt(intent.memo) > MAX_ID_MEMO)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['memo'],
        message: 'an id memo must be an unsigned 64-bit integer',
      });
    }

    if (intent.memoType === 'hash' && !/^[0-9a-f]{64}$/.test(intent.memo)) {
      ctx.addIssue({
        code: 'custom',
        path: ['memo'],
        message: 'a hash memo must be 64 lowercase hex characters',
      });
    }
  });

export type OnrampIntent = z.infer<typeof OnrampIntentSchema>;
