import { z } from 'zod';

// ─── Cadence ──────────────────────────────────────────────────────────────────

/**
 * Named cadences for recurring intents.
 * - `daily`: execute every 24 hours from the start time
 * - `weekly`: execute every 7 days from the start time
 * - `biweekly`: execute every 14 days from the start time
 * - `monthly`: execute on the same day-of-month each month
 */
export type CadenceNamed = 'daily' | 'weekly' | 'biweekly' | 'monthly';

/**
 * A cron expression or named cadence value.
 * Cron format: five-field (minute hour day-of-month month day-of-week) as used
 * by node-cron and unix crontab.
 */
export const CadenceSchema = z.union([
  z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  z
    .string()
    .regex(
      /^(\*|[0-9,-\/]+)\s+(\*|[0-9,-\/]+)\s+(\*|[0-9,-\/]+)\s+(\*|[0-9,-\/]+)\s+(\*|[0-9,-\/]+)$/,
      { message: 'Must be a valid 5-field cron expression (min hr dom mon dow)' }
    ),
]);

export type Cadence = z.infer<typeof CadenceSchema>;

// ─── RecurringIntent ──────────────────────────────────────────────────────────

export type RecurringIntentStatus = 'active' | 'paused' | 'completed' | 'expired';

/**
 * A recurring intent is a signed-once authorization that instructs the system
 * to execute off-ramp intents on a schedule. The user signs the authorization
 * envelope once, and the scheduler creates + executes individual intents each
 * cycle from the stored template.
 */
export const RecurringIntentSchema = z.object({
  /** Unique identifier for this recurring intent (UUID). */
  id: z.string().min(1, { message: 'id is required' }),

  // ── Intent template ──────────────────────────────────────────────────────

  /** Corridor identifier (e.g. 'usdc-ngn'). */
  corridorId: z.string().min(1, { message: 'corridorId is required' }),
  /** Sell amount as a positive decimal string (e.g. '500'). */
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, { message: 'amount must be a non-negative decimal string' })
    .refine((v) => parseFloat(v) > 0, { message: 'amount must be greater than zero' }),
  /** Source asset code (e.g. 'USDC'). */
  sourceAsset: z.string().min(1, { message: 'sourceAsset is required' }),
  /** Destination asset/fiat code (e.g. 'NGN'). */
  destinationAsset: z.string().min(1, { message: 'destinationAsset is required' }),
  /** User's Stellar public key. */
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, {
    message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
  }),
  /** Destination account/address for the fiat payout. */
  recipient: z.string().min(1, { message: 'recipient is required' }),
  /** Preferred delivery method for the fiat payout. */
  deliveryHint: z.enum(['bank_account', 'cash', 'mobile_money']).optional(),

  // ── Cadence ──────────────────────────────────────────────────────────────

  /** How often to execute. */
  cadence: CadenceSchema,

  // ── Constraints ──────────────────────────────────────────────────────────

  /**
   * Maximum acceptable slippage in basis points (bps).
   * 100 bps = 1%. If the best available rate deviates from a reference rate
   * by more than this, the cycle is skipped.
   * Default: 200 (2%).
   */
  maxSlippageBps: z.number().int().min(0).max(10000).default(200),
  /**
   * Hard floor on the exchange rate (local currency units per 1 sell asset).
   * If no quote meets or exceeds this floor, the cycle is skipped.
   * As a string to preserve decimal precision. Default: '0' (no floor).
   */
  rateFloor: z
    .string()
    .regex(/^\d+(\.\d+)?$/, { message: 'rateFloor must be a non-negative decimal string' })
    .default('0'),

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Maximum number of cycles to execute. Absent = unbounded. */
  maxCycles: z.number().int().min(1).optional(),
  /** RFC 3339 timestamp after which no more cycles execute. */
  stopDate: z.string().datetime({ message: 'stopDate must be an RFC 3339 datetime' }).optional(),
  /** When this recurring intent was created. */
  createdAt: z.string().datetime(),
  /** When the next execution attempt should occur. */
  nextExecutionAt: z.string().datetime(),
  /** Current lifecycle status. */
  status: z.enum(['active', 'paused', 'completed', 'expired']).default('active'),

  // ── Counters ─────────────────────────────────────────────────────────────

  /** How many cycles have been executed successfully. */
  executedCycles: z.number().int().min(0).default(0),
  /** How many cycles were skipped (rate out of range, no anchors, etc.). */
  skippedCycles: z.number().int().min(0).default(0),
  /** How many cycles failed with an unexpected error. */
  failedCycles: z.number().int().min(0).default(0),

  // ── Metadata ─────────────────────────────────────────────────────────────

  /** Optional free-form extension data. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RecurringIntent = z.infer<typeof RecurringIntentSchema>;

// ─── Recurring Authorization (sign-once envelope) ─────────────────────────────

/**
 * The envelope the user signs once to authorize a recurring intent series.
 * The signature covers the canonical JSON of the inner recurringIntent.
 */
export const RecurringAuthorizationSchema = z
  .object({
    /** The recurring intent the user is authorizing. */
    recurringIntent: RecurringIntentSchema,
    /** Hex-encoded SHA-256 of the canonicalized recurring intent JSON. */
    hash: z.string().regex(/^[0-9a-f]{64}$/, {
      message: 'hash must be a lowercase hex-encoded SHA-256 (64 chars)',
    }),
    /** Base64-encoded Ed25519 signature over the canonical recurring intent JSON bytes. */
    signature: z.string().min(1, { message: 'signature is required' }),
    /** Stellar public key that produced the signature (must match recurringIntent.publicKey). */
    publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, {
      message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
    }),
  })
  .refine((data) => data.publicKey === data.recurringIntent.publicKey, {
    message: 'authorization publicKey must match recurringIntent publicKey',
    path: ['publicKey'],
  });

export type RecurringAuthorization = z.infer<typeof RecurringAuthorizationSchema>;

// ─── RecurringExecution (single cycle record) ─────────────────────────────────

export type RecurringExecutionStatus = 'scheduled' | 'executed' | 'skipped' | 'failed';

export type RecurringSkipReason =
  | 'rate_out_of_range'
  | 'slippage_exceeded'
  | 'no_anchors_available'
  | 'all_quotes_expired'
  | 'floor_not_met'
  | 'fee_budget_exceeded';

/**
 * A record of one cycle execution for a recurring intent.
 */
export interface RecurringExecution {
  /** Unique execution id. */
  id: string;
  /** The parent recurring intent id. */
  recurringIntentId: string;
  /** Execution sequence number (1-based). */
  cycleNumber: number;
  /** When this cycle was scheduled to execute. */
  scheduledAt: string;
  /** When execution was attempted. */
  attemptedAt: string;
  /** Result status. */
  status: RecurringExecutionStatus;
  /** If skipped, the reason why. */
  skipReason?: RecurringSkipReason;
  /** If executed, the anchor that was selected. */
  anchorId?: string;
  /** If executed, the anchor name. */
  anchorName?: string;
  /** If executed, the quote id used. */
  quoteId?: string;
  /** If executed, the exchange rate achieved. */
  executedRate?: string;
  /** If executed, the net amount received in buy_asset. */
  netAmount?: string;
  /** If failed, the error message. */
  error?: string;
}

// ─── Cycle evaluation input/output ────────────────────────────────────────────

/**
 * Input to the cycle evaluator: a recurring intent plus available quotes.
 */
export interface CycleEvaluationInput {
  recurringIntent: RecurringIntent;
  /** Fresh quotes for the corridor. Empty array means no anchors are available. */
  quotes: Array<{
    anchorId: string;
    anchorName: string;
    buyAmount: string;
    price: string;
    fee: { total: string; percent?: string };
    expiresAt: string;
    quoteId?: string;
  }>;
  /**
   * Optional reference rate used for slippage computation.
   * If not provided, the best available quote's rate is used as the reference.
   */
  referenceRate?: string;
  /** Current timestamp (injectable for deterministic testing). */
  now?: Date;
}

/**
 * The result of evaluating one cycle of a recurring intent.
 */
export type CycleEvaluationResult =
  | {
      ok: true;
      action: 'execute';
      anchorId: string;
      anchorName: string;
      quoteId: string;
      rate: string;
      netAmount: string;
      nextExecutionAt: string;
    }
  | {
      ok: false;
      action: 'skip';
      reason: RecurringSkipReason;
      message: string;
      nextExecutionAt: string;
    }
  | {
      ok: false;
      action: 'complete';
      reason: 'max_cycles_reached' | 'stop_date_passed' | 'expired';
      message: string;
    };
