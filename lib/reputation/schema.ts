import { z } from 'zod';
import { OUTCOME_STATUSES, type OutcomeLogRow, type OutcomeStatus } from '@/types/reputation';
import { AMOUNT_PATTERN, SIGNED_AMOUNT_PATTERN, STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import { ANCHORS } from '@/constants/anchors';

// ─── Zod schema for the outcome log row (Issue #127 / #218) ────────────────────

const decimalString = z.string().min(1).regex(SIGNED_AMOUNT_PATTERN, 'must be a decimal string');

/** Validates every persisted/ingested outcome row. */
export const OutcomeLogRowSchema = z.object({
  intentHash: z.string().min(1),
  anchorId: z.string().min(1),
  corridor: z.string().min(1),
  quotedRate: decimalString,
  deliveredRate: decimalString.nullable(),
  quotedAmount: decimalString,
  deliveredAmount: decimalString.nullable(),
  settleSeconds: z.number().nonnegative().nullable(),
  outcome: z.enum(OUTCOME_STATUSES),
  createdAt: z.string().datetime({ offset: true }),
  stellarTransactionId: z.string().min(1).nullable(),
  reconciledAt: z.string().datetime({ offset: true }).nullable(),
  disputed: z.boolean(),
  disputedReason: z.string().min(1).nullable(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  oracleTxHash: z.string().min(1).nullable(),
  attested: z.boolean(),
  signerAccount: z.string().regex(STELLAR_PUBKEY_PATTERN).nullable(),
}) satisfies z.ZodType<OutcomeLogRow>;

// ─── Append input (POST /api/reputation/append) ───────────────────────────────
//
// Every field a client can set is bounded here, because an accepted row feeds
// anchor scores and, via the publisher, the on-chain oracle. Server-managed
// columns (createdAt, reconciliation, dispute and publish state) are not part of
// the input at all: zod strips unknown keys, so a client cannot set them.

/** Lowercase hex SHA-256, the shape `hashIntent` produces. */
export const INTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
/** A Stellar transaction hash, as SEP-6/24 report it in `stellar_transaction_id`. */
const STELLAR_TX_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

/** Upper bound on an amount (source or destination currency). Far above any real transfer. */
export const MAX_OUTCOME_AMOUNT = 1e15;
/** Upper bound on an exchange rate. The weakest fiat against USD is ~1e5 per unit. */
export const MAX_OUTCOME_RATE = 1e9;
/** Ninety days. A withdrawal still open after that is not a settlement time worth scoring. */
export const MAX_SETTLE_SECONDS = 90 * 24 * 60 * 60;

function boundedDecimal(max: number, label: string) {
  return z
    .string()
    .max(40, `${label} is too long`)
    .regex(AMOUNT_PATTERN, `${label} must be a non-negative decimal string`)
    .refine((v) => Number(v) <= max, `${label} exceeds ${max}`);
}

const ANCHOR_CORRIDORS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  ANCHORS.map((anchor) => [anchor.id, new Set(anchor.corridors)])
);

/**
 * The shape a client may POST to /api/reputation/append.
 *
 * `publicKey` + `signature` are required: the signature is an Ed25519 signature
 * by `publicKey` over `intentHash` (see `verifyIntentSignature`). The route
 * rejects the row with 401 when it does not verify.
 */
export const AppendOutcomeInputSchema = z
  .object({
    intentHash: z
      .string()
      .regex(INTENT_HASH_PATTERN, 'intentHash must be a lowercase hex SHA-256 (64 chars)'),
    anchorId: z
      .string()
      .max(64)
      .refine((id) => ANCHOR_CORRIDORS.has(id), 'anchorId is not a registered anchor'),
    corridor: z.string().min(1).max(32),
    quotedRate: boundedDecimal(MAX_OUTCOME_RATE, 'quotedRate'),
    quotedAmount: boundedDecimal(MAX_OUTCOME_AMOUNT, 'quotedAmount'),
    outcome: z.enum(OUTCOME_STATUSES),
    deliveredRate: boundedDecimal(MAX_OUTCOME_RATE, 'deliveredRate').nullish(),
    deliveredAmount: boundedDecimal(MAX_OUTCOME_AMOUNT, 'deliveredAmount').nullish(),
    settleSeconds: z.number().int().nonnegative().max(MAX_SETTLE_SECONDS).nullish(),
    stellarTransactionId: z
      .string()
      .regex(STELLAR_TX_HASH_PATTERN, 'stellarTransactionId must be a Stellar transaction hash')
      .nullish(),
    publicKey: z.string().regex(STELLAR_PUBKEY_PATTERN, 'publicKey must be a Stellar public key'),
    // A 64-byte Ed25519 signature is 88 base64 characters; leave room for padding variants.
    signature: z.string().min(1, 'signature is required').max(128),
  })
  .superRefine((input, ctx) => {
    const served = ANCHOR_CORRIDORS.get(input.anchorId);
    if (served && !served.has(input.corridor)) {
      ctx.addIssue({
        code: 'custom',
        path: ['corridor'],
        message: `corridor ${input.corridor} is not served by ${input.anchorId}`,
      });
    }
  });

export type AppendOutcomeInput = z.infer<typeof AppendOutcomeInputSchema>;

/**
 * Normalizes a validated, signature-verified append input into a full outcome
 * row. Only call this after `verifyIntentSignature` has accepted the input's
 * signature: the row is stamped `attested` with `publicKey` as its signer.
 */
export function toOutcomeLogRow(input: AppendOutcomeInput, now = new Date()): OutcomeLogRow {
  return {
    intentHash: input.intentHash,
    anchorId: input.anchorId,
    corridor: input.corridor,
    quotedRate: input.quotedRate,
    deliveredRate: input.deliveredRate ?? null,
    quotedAmount: input.quotedAmount,
    deliveredAmount: input.deliveredAmount ?? null,
    settleSeconds: input.settleSeconds ?? null,
    outcome: input.outcome,
    createdAt: now.toISOString(),
    stellarTransactionId: input.stellarTransactionId ?? null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: input.publicKey,
  };
}

/** Maps a SEP-24 terminal status to an outcome enum value. */
export function outcomeFromStatus(status: string): OutcomeStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'refunded':
      return 'refunded';
    case 'expired':
      return 'expired';
    case 'error':
      return 'error';
    default:
      return 'error';
  }
}
