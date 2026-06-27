import { z } from 'zod';
import { OUTCOME_STATUSES, type OutcomeLogRow, type OutcomeStatus } from '@/types/reputation';

// ─── Zod schema for the outcome log row (Issue #127 / #218) ────────────────────

const decimalString = z
  .string()
  .min(1)
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');

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
}) satisfies z.ZodType<OutcomeLogRow>;

/**
 * The shape a client may POST to /api/reputation/append. Server-managed fields
 * (delivery, reconciliation, timestamp) are optional and defaulted.
 */
export const AppendOutcomeInputSchema = z.object({
  intentHash: z.string().min(1),
  anchorId: z.string().min(1),
  corridor: z.string().min(1),
  quotedRate: decimalString,
  quotedAmount: decimalString,
  outcome: z.enum(OUTCOME_STATUSES),
  deliveredRate: decimalString.nullish(),
  deliveredAmount: decimalString.nullish(),
  settleSeconds: z.number().nonnegative().nullish(),
  stellarTransactionId: z.string().min(1).nullish(),
  createdAt: z.string().datetime({ offset: true }).optional(),
});

export type AppendOutcomeInput = z.infer<typeof AppendOutcomeInputSchema>;

/** Normalizes a validated append input into a full outcome row. */
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
    createdAt: input.createdAt ?? now.toISOString(),
    stellarTransactionId: input.stellarTransactionId ?? null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
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
