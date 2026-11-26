import { z } from 'zod';
import { AMOUNT_PATTERN, STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';

// ─── Standing-order execution intent (REC009) ────────────────────────────────
//
// The off-ramp outcome intent the user signs once per cycle. It is the same
// `offramp-outcome` object /offramp already signs for the reputation append,
// plus the standing order id and the cycle it confirms (REC011 builds it with
// withRecurringFields). Browser-safe: zod and patterns only.

export const RecurringExecutionIntentSchema = z
  .object({
    type: z.literal('offramp-outcome'),
    sourceAsset: z.string().min(1),
    destinationAsset: z.string().min(1),
    amount: z.string().regex(AMOUNT_PATTERN),
    sender: z.string().regex(STELLAR_PUBKEY_PATTERN),
    recipient: z.string().min(1),
    anchorId: z.string().min(1),
    corridor: z.string().min(1),
    transactionId: z.string().min(1).max(200),
    recurringAuthorizationId: z.string().uuid(),
    cycleNumber: z.number().int().min(1),
    // SLP004: a signed off-ramp outcome may carry a receive floor.
    minReceive: z.string().regex(AMOUNT_PATTERN).optional(),
  })
  .strict();

export type RecurringExecutionIntent = z.infer<typeof RecurringExecutionIntentSchema>;
