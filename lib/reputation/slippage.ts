import { AMOUNT_PATTERN } from '@/lib/patterns';
import { formatDecimal, parseDecimal } from '@/lib/decimal';
import type { OutcomeStatus } from '@/types/reputation';

export type SlippageEvaluation =
  | { kind: 'not_applicable'; reason: 'not_completed' | 'no_floor' | 'no_amount_out' }
  | { kind: 'met'; surplus: string }
  | { kind: 'breach'; shortfall: string; shortfallBps: number };

/**
 * Pure, exact-decimal slippage evaluator.
 * Compares the anchor's settled amount against the signed minReceive floor.
 */
export function evaluateSlippage(input: {
  minReceive: string | null | undefined;
  amountOut: string | null | undefined;
  outcome: OutcomeStatus;
}): SlippageEvaluation {
  // 1. outcome !== 'completed' → not_completed (partial included; partial delivery is a dispute/refund matter);
  if (input.outcome !== 'completed') {
    return { kind: 'not_applicable', reason: 'not_completed' };
  }

  // 2. minReceive missing, not matching AMOUNT_PATTERN, or zero → no_floor;
  if (
    !input.minReceive ||
    !AMOUNT_PATTERN.test(input.minReceive) ||
    parseDecimal(input.minReceive) === 0n
  ) {
    return { kind: 'not_applicable', reason: 'no_floor' };
  }

  // 3. amountOut missing or not matching AMOUNT_PATTERN → no_amount_out;
  if (!input.amountOut || !AMOUNT_PATTERN.test(input.amountOut)) {
    return { kind: 'not_applicable', reason: 'no_amount_out' };
  }

  // 4. min = parseDecimal(minReceive), out = parseDecimal(amountOut);
  // out >= min → { kind: 'met', surplus: formatDecimal(out - min) };
  // else → { kind: 'breach', shortfall: formatDecimal(min - out), shortfallBps: Number(((min - out) * 10000n) / min) } (integer floor).
  const min = parseDecimal(input.minReceive);
  const out = parseDecimal(input.amountOut);

  if (out >= min) {
    return { kind: 'met', surplus: formatDecimal(out - min) };
  }

  const diff = min - out;
  const shortfall = formatDecimal(diff);
  const shortfallBps = Number((diff * 10000n) / min);

  return { kind: 'breach', shortfall, shortfallBps };
}
