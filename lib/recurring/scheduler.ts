/**
 * lib/recurring/scheduler.ts
 *
 * Recurring intent scheduler — evaluates each cycle of a recurring intent
 * against fresh quotes, enforcing rate-floor and slippage constraints.
 * Integrates with the existing solveSingleAnchor router for quote selection.
 */

import { getLogger } from '@/lib/logger';
import { computeNextExecutionAt, isStopDatePassed, isMaxCyclesReached, isDue } from './cadence';
import {
  getRecurringIntent,
  updateRecurringIntent,
  recordExecution,
  listDueIntents,
  getExecutions,
} from './store';
import type {
  CycleEvaluationInput,
  CycleEvaluationResult,
  RecurringExecution,
} from '@/types/recurring';

const log = getLogger('recurring/scheduler');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of consecutive skip cycles before an intent is paused. */
export const MAX_CONSECUTIVE_SKIPS = 3;

/** Reference rate used when no external reference is available for slippage checks. */
export const FALLBACK_REFERENCE_RATE = '0';

// ─── Rate comparison utilities ────────────────────────────────────────────────

/**
 * Compare two decimal strings numerically using BigInt scaled arithmetic
 * to avoid float precision loss on large financial amounts.
 * Consistent with the router's compareDecimals in lib/router/solve.ts.
 *
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */

function parseDecimal(value: string): bigint {
  let str = value.trim();
  let sign = 1n;
  if (str.startsWith('-')) {
    sign = -1n;
    str = str.slice(1);
  } else if (str.startsWith('+')) {
    str = str.slice(1);
  }

  let exp = 0;
  const eIdx = str.search(/[eE]/);
  if (eIdx !== -1) {
    exp = parseInt(str.slice(eIdx + 1), 10) || 0;
    str = str.slice(0, eIdx);
  }

  const [intPart = '0', fracPart = ''] = str.split('.');
  const digits = `${intPart}${fracPart}`.replace(/\D/g, '') || '0';
  const pointFromRight = fracPart.length - exp;
  const shift = 7 - pointFromRight;
  const magnitude =
    shift >= 0 ? BigInt(digits) * 10n ** BigInt(shift) : BigInt(digits) / 10n ** BigInt(-shift);
  return sign * magnitude;
}

export function compareDecimals(a: string, b: string): number {
  const bigA = parseDecimal(a);
  const bigB = parseDecimal(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

/**
 * Select the best quote from a list by highest buy amount.
 */
function selectBestQuote(
  quotes: CycleEvaluationInput['quotes']
): CycleEvaluationInput['quotes'][number] | null {
  if (quotes.length === 0) return null;

  return quotes.reduce((best, current) => {
    if (compareDecimals(current.buyAmount, best.buyAmount) > 0) return current;
    return best;
  });
}

// ─── Slippage computation ─────────────────────────────────────────────────────

/**
 * Compute the slippage of a rate relative to a reference rate, in basis points.
 *
 * slippageBps = |rate - reference| / reference * 10000
 *
 * @param rate      The actual rate achieved.
 * @param reference The reference/expected rate.
 * @returns Slippage in basis points (non-negative).
 */
export function computeSlippageBps(rate: string, reference: string): number {
  const rateNum = parseFloat(rate);
  const refNum = parseFloat(reference);

  if (Number.isNaN(rateNum) || Number.isNaN(refNum) || refNum === 0) {
    return 0;
  }

  return Math.round((Math.abs(rateNum - refNum) / refNum) * 10000);
}

// ─── Cycle evaluation ─────────────────────────────────────────────────────────

/**
 * Check if the best quote's rate meets the rate floor.
 */
function meetsRateFloor(rate: string, floor: string): boolean {
  const floorNum = parseFloat(floor);
  if (Number.isNaN(floorNum) || floorNum <= 0) return true;
  return compareDecimals(rate, floor) >= 0;
}

/**
 * Evaluate one cycle of a recurring intent.
 *
 * 1. Check lifecycle constraints (max cycles, stop date).
 * 2. Evaluate available quotes against rate floor and slippage.
 * 3. Select the best eligible quote or determine skip/complete reason.
 * 4. Compute the next execution time.
 *
 * This is a pure function — it does not mutate state.
 * Callers (the API route or a cron worker) apply the result to the store.
 */
export function evaluateCycle(input: CycleEvaluationInput): CycleEvaluationResult {
  const { recurringIntent: ri, quotes, referenceRate, now = new Date() } = input;

  // ── Lifecycle checks ────────────────────────────────────────────────────

  if (isStopDatePassed(ri.stopDate, now)) {
    return {
      ok: false,
      action: 'complete',
      reason: 'stop_date_passed',
      message: `Stop date ${ri.stopDate} has passed`,
    };
  }

  if (isMaxCyclesReached(ri.executedCycles, ri.maxCycles)) {
    return {
      ok: false,
      action: 'complete',
      reason: 'max_cycles_reached',
      message: `Max cycles (${ri.maxCycles}) reached (${ri.executedCycles} executed)`,
    };
  }

  if (ri.status !== 'active') {
    return {
      ok: false,
      action: 'complete',
      reason: 'expired',
      message: `Recurring intent is not active (status: ${ri.status})`,
    };
  }

  // ── Quote evaluation ────────────────────────────────────────────────────

  // No quotes available at all
  if (quotes.length === 0) {
    return {
      ok: false,
      action: 'skip',
      reason: 'no_anchors_available',
      message: 'No anchor quotes available for this corridor',
      nextExecutionAt: computeNextExecutionAt(ri.cadence, now).toISOString(),
    };
  }

  // Filter to non-expired quotes
  const validQuotes = quotes.filter((q) => {
    const expiresAt = new Date(q.expiresAt);
    return expiresAt.getTime() > now.getTime();
  });

  if (validQuotes.length === 0) {
    return {
      ok: false,
      action: 'skip',
      reason: 'all_quotes_expired',
      message: `All ${quotes.length} quotes have expired`,
      nextExecutionAt: computeNextExecutionAt(ri.cadence, now).toISOString(),
    };
  }

  // Select the best quote by buy amount
  const best = selectBestQuote(validQuotes);
  if (!best) {
    return {
      ok: false,
      action: 'skip',
      reason: 'no_anchors_available',
      message: 'Could not select a best quote',
      nextExecutionAt: computeNextExecutionAt(ri.cadence, now).toISOString(),
    };
  }

  // Check rate floor
  if (!meetsRateFloor(best.price, ri.rateFloor)) {
    return {
      ok: false,
      action: 'skip',
      reason: 'rate_out_of_range',
      message: `Best rate ${best.price} is below floor ${ri.rateFloor}`,
      nextExecutionAt: computeNextExecutionAt(ri.cadence, now).toISOString(),
    };
  }

  // Check slippage if a reference rate is available
  const ref = referenceRate ?? FALLBACK_REFERENCE_RATE;
  if (ref !== FALLBACK_REFERENCE_RATE) {
    const slippageBps = computeSlippageBps(best.price, ref);
    if (slippageBps > ri.maxSlippageBps) {
      return {
        ok: false,
        action: 'skip',
        reason: 'slippage_exceeded',
        message: `Slippage ${slippageBps} bps exceeds max ${ri.maxSlippageBps} bps (rate: ${best.price} vs ref: ${ref})`,
        nextExecutionAt: computeNextExecutionAt(ri.cadence, now).toISOString(),
      };
    }
  }

  // ── Execute ─────────────────────────────────────────────────────────────

  const nextExec = computeNextExecutionAt(ri.cadence, now).toISOString();

  return {
    ok: true,
    action: 'execute',
    anchorId: best.anchorId,
    anchorName: best.anchorName,
    quoteId: best.quoteId ?? `quote-${Date.now()}`,
    rate: best.price,
    netAmount: best.buyAmount,
    nextExecutionAt: nextExec,
  };
}

// ─── Cycle execution (stateful) ───────────────────────────────────────────────

let lastExecutionId = 0;

function nextExecutionId(): string {
  lastExecutionId += 1;
  return `exec-${Date.now()}-${lastExecutionId}`;
}

/**
 * Run a full cycle for a specific recurring intent by id.
 *
 * This is the main entry point called by the API/cron:
 * 1. Fetch the recurring intent from the store
 * 2. Evaluate the cycle against provided quotes
 * 3. Update the store with the execution record
 * 4. Update counters and next execution time
 *
 * @param recurringIntentId  The id of the recurring intent to execute.
 * @param quotes             Fresh quotes for the corridor.
 * @param referenceRate      Optional reference rate for slippage checks.
 * @param now                Current time (injectable for testing).
 */
export function executeCycle(
  recurringIntentId: string,
  quotes: CycleEvaluationInput['quotes'],
  referenceRate?: string,
  now: Date = new Date()
): CycleEvaluationResult {
  const ri = getRecurringIntent(recurringIntentId);
  if (!ri) {
    return {
      ok: false,
      action: 'complete',
      reason: 'expired',
      message: `Recurring intent ${recurringIntentId} not found`,
    };
  }

  if (!isDue(ri.nextExecutionAt, now)) {
    return {
      ok: false,
      action: 'skip',
      reason: 'no_anchors_available',
      message: `Not yet due (next: ${ri.nextExecutionAt}, now: ${now.toISOString()})`,
      nextExecutionAt: ri.nextExecutionAt,
    };
  }

  const evalInput: CycleEvaluationInput = {
    recurringIntent: ri,
    quotes,
    now,
  };
  // Only include referenceRate when it's defined to satisfy exactOptionalPropertyTypes
  if (referenceRate !== undefined) {
    evalInput.referenceRate = referenceRate;
  }

  const result = evaluateCycle(evalInput);

  // Build execution record
  const execution: RecurringExecution = {
    id: nextExecutionId(),
    recurringIntentId: ri.id,
    cycleNumber: ri.executedCycles + ri.skippedCycles + ri.failedCycles + 1,
    scheduledAt: ri.nextExecutionAt,
    attemptedAt: now.toISOString(),
    status:
      result.action === 'execute' ? 'executed' : result.action === 'skip' ? 'skipped' : 'failed',
  };

  if (result.action === 'execute' && result.ok) {
    execution.anchorId = result.anchorId;
    execution.anchorName = result.anchorName;
    execution.quoteId = result.quoteId;
    execution.executedRate = result.rate;
    execution.netAmount = result.netAmount;

    recordExecution(execution);

    updateRecurringIntent(recurringIntentId, {
      executedCycles: ri.executedCycles + 1,
      nextExecutionAt: result.nextExecutionAt,
    });

    log.info(
      {
        recurringIntentId,
        cycleNumber: execution.cycleNumber,
        anchorId: result.anchorId,
        rate: result.rate,
      },
      'cycle executed'
    );
  } else if (result.action === 'skip') {
    execution.skipReason = result.reason;
    execution.status = 'skipped';

    recordExecution(execution);

    updateRecurringIntent(recurringIntentId, {
      skippedCycles: ri.skippedCycles + 1,
      nextExecutionAt: result.nextExecutionAt,
    });

    log.warn(
      {
        recurringIntentId,
        cycleNumber: execution.cycleNumber,
        reason: result.reason,
      },
      'cycle skipped'
    );

    // Auto-pause after too many consecutive skips
    checkConsecutiveSkips(recurringIntentId);
  } else if (result.action === 'complete') {
    execution.status = 'failed';
    execution.error = result.message;

    recordExecution(execution);

    updateRecurringIntent(recurringIntentId, {
      status: 'completed',
      failedCycles: ri.failedCycles + 1,
    });

    log.info(
      {
        recurringIntentId,
        cycleNumber: execution.cycleNumber,
        reason: result.reason,
      },
      'recurring intent completed'
    );
  }

  return result;
}

/**
 * Check if a recurring intent has had too many consecutive skips and pause it.
 */
function checkConsecutiveSkips(recurringIntentId: string): void {
  const history: RecurringExecution[] = getExecutions(recurringIntentId);

  // Count consecutive skips at the tail
  let consecutive = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.status === 'skipped') {
      consecutive++;
    } else {
      break;
    }
  }

  if (consecutive >= MAX_CONSECUTIVE_SKIPS) {
    updateRecurringIntent(recurringIntentId, { status: 'paused' });
    log.warn(
      {
        recurringIntentId,
        consecutiveSkips: consecutive,
      },
      'recurring intent paused after consecutive skips'
    );
  }
}

// ─── Batch evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate all due recurring intents against the provided quote fetcher.
 *
 * @param quoteFetcher  Function that returns quotes for a given corridor and amount.
 * @param now           Current time (injectable for testing).
 * @returns Array of execution results.
 */
export async function evaluateAllDueIntents(
  quoteFetcher: (corridorId: string, amount: string) => Promise<CycleEvaluationInput['quotes']>,
  now: Date = new Date()
): Promise<{ intentId: string; result: CycleEvaluationResult }[]> {
  const due = listDueIntents(now);
  const results: { intentId: string; result: CycleEvaluationResult }[] = [];

  for (const ri of due) {
    let quotes: CycleEvaluationInput['quotes'] = [];

    try {
      quotes = await quoteFetcher(ri.corridorId, ri.amount);
    } catch (err) {
      log.error(
        {
          recurringIntentId: ri.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        },
        'quote fetch failed'
      );
      // Treat quote fetch failure as no anchors available
      quotes = [];
    }

    const result = executeCycle(ri.id, quotes, undefined, now);
    results.push({ intentId: ri.id, result });
  }

  return results;
}
