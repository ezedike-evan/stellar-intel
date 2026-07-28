import { z } from 'zod';
import { AMOUNT_PATTERN } from '@/lib/patterns';

/**
 * lib/intent/generic.ts
 *
 * The universal intent primitive (issue #818). The UI, API, and SDK collapse
 * onto one "submit an intent" surface: a single off-ramp and a recurring/chained
 * intent are the same primitive, differing only in `type`. `expandIntent`
 * collapses any generic intent into the concrete off-ramp legs an executor runs.
 */

const OfframpFields = z.object({
  sourceAsset: z.string().min(1),
  destinationAsset: z.string().min(1),
  amount: z.string().regex(AMOUNT_PATTERN, 'amount must be a positive decimal string'),
  sender: z.string().min(1),
  recipient: z.string().min(1),
});

export const RECURRING_INTERVALS = ['daily', 'weekly', 'monthly'] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

const INTERVAL_SECONDS: Record<RecurringInterval, number> = {
  daily: 86_400,
  weekly: 604_800,
  monthly: 2_592_000, // 30 days
};

/** Canonical generic intent — a single off-ramp or a recurring schedule of one. */
export const GenericIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offramp') }).merge(OfframpFields),
  z.object({
    type: z.literal('recurring'),
    interval: z.enum(RECURRING_INTERVALS),
    occurrences: z.number().int().min(1).max(52),
    template: OfframpFields,
  }),
]);

export type GenericIntent = z.infer<typeof GenericIntentSchema>;

/** One concrete off-ramp leg produced by collapsing a generic intent. */
export interface OfframpLeg {
  type: 'offramp';
  sourceAsset: string;
  destinationAsset: string;
  amount: string;
  sender: string;
  recipient: string;
  /** Position within a recurring intent (0 for a single off-ramp). */
  sequence: number;
  /** Seconds after submission this leg should execute (0 for the first). */
  executeAfterSeconds: number;
}

/**
 * Collapses a generic intent into its off-ramp legs: a single off-ramp yields
 * one leg; a recurring intent yields one leg per occurrence, spaced by the
 * interval. This is the one primitive every entrypoint routes through.
 */
export function expandIntent(intent: GenericIntent): OfframpLeg[] {
  if (intent.type === 'offramp') {
    return [
      {
        type: 'offramp',
        sourceAsset: intent.sourceAsset,
        destinationAsset: intent.destinationAsset,
        amount: intent.amount,
        sender: intent.sender,
        recipient: intent.recipient,
        sequence: 0,
        executeAfterSeconds: 0,
      },
    ];
  }

  const step = INTERVAL_SECONDS[intent.interval];
  const t = intent.template;
  return Array.from({ length: intent.occurrences }, (_, i) => ({
    type: 'offramp' as const,
    sourceAsset: t.sourceAsset,
    destinationAsset: t.destinationAsset,
    amount: t.amount,
    sender: t.sender,
    recipient: t.recipient,
    sequence: i,
    executeAfterSeconds: i * step,
  }));
}
