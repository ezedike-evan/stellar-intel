/**
 * lib/router/solve.ts
 *
 * Intent router — two complementary solvers:
 *   - solveSingleAnchor: picks the best SEP-38 quote meeting floor + deadline (issue #119)
 *   - solveWithFallback: rate-based fallback re-solve across SEP-24 anchors (issue #215)
 */

import { fetchAllAnchorFees, computeRateComparison } from '@/lib/stellar/sep24';
import type {
  AnchorRate,
  EvaluatedQuote,
  Intent,
  Plan,
  RateComparison,
  SolverResult,
} from '@/types';

// ─── solveSingleAnchor ────────────────────────────────────────────────────────

/**
 * Compares two decimal strings numerically.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 *
 * Uses BigInt scaled to 7 decimal places to avoid float precision loss on
 * large financial amounts.
 */
function compareDecimals(a: string, b: string): number {
  // Convert a decimal string — including scientific notation like "1.5e3" — to a
  // fixed-point bigint scaled to 7 decimal places, avoiding float precision loss.
  const toBigInt = (s: string): bigint => {
    let str = s.trim();
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
    // Digits to the right of the decimal point after applying the exponent.
    const pointFromRight = fracPart.length - exp;
    const shift = 7 - pointFromRight; // scale to 7 decimal places
    const magnitude =
      shift >= 0 ? BigInt(digits) * 10n ** BigInt(shift) : BigInt(digits) / 10n ** BigInt(-shift);
    return sign * magnitude;
  };
  const bigA = toBigInt(a);
  const bigB = toBigInt(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

function meetsFloor(quote: EvaluatedQuote, intent: Intent): boolean {
  return compareDecimals(quote.buy_amount, intent.minReceive) >= 0;
}

function isDeadlineExpired(deadline: string): boolean {
  return new Date(deadline).getTime() <= Date.now();
}

function isQuoteExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

/**
 * Selects the best single-anchor SEP-38 quote that meets the intent's floor
 * and deadline constraints. Returns a typed discriminated-union result.
 */
export function solveSingleAnchor(intent: Intent, evaluatedQuotes: EvaluatedQuote[]): SolverResult {
  if (isDeadlineExpired(intent.deadline)) {
    return {
      ok: false,
      error: 'all_quotes_expired',
      details: `Intent deadline ${intent.deadline} has already passed`,
    };
  }

  const validQuotes: EvaluatedQuote[] = [];
  const expiredQuotes: EvaluatedQuote[] = [];
  const floorViolations: EvaluatedQuote[] = [];

  for (const quote of evaluatedQuotes) {
    if (isQuoteExpired(quote.expires_at)) {
      expiredQuotes.push(quote);
    } else if (!meetsFloor(quote, intent)) {
      floorViolations.push(quote);
    } else {
      validQuotes.push(quote);
    }
  }

  if (validQuotes.length === 0) {
    if (evaluatedQuotes.length === 0) {
      return { ok: false, error: 'no_eligible_route' };
    }
    if (expiredQuotes.length === evaluatedQuotes.length) {
      return {
        ok: false,
        error: 'all_quotes_expired',
        details: `All ${evaluatedQuotes.length} quote(s) have expired`,
      };
    }
    if (floorViolations.length > 0) {
      const detail = floorViolations
        .map((q) => `${q.anchorName}: ${q.buy_amount} < ${intent.minReceive}`)
        .join('; ');
      return {
        ok: false,
        error: 'floor_not_met',
        details: `No quotes meet minimum receive of ${intent.minReceive}. ${detail}`,
      };
    }
    return { ok: false, error: 'no_eligible_route' };
  }

  const bestQuote = validQuotes.reduce((best, current) =>
    compareDecimals(current.buy_amount, best.buy_amount) > 0 ? current : best
  );

  const plan: Plan = {
    type: 'single_anchor',
    anchorId: bestQuote.anchorId,
    anchorName: bestQuote.anchorName,
    quoteId: bestQuote.id,
    netAmount: bestQuote.buy_amount,
    fee: bestQuote.fee.total,
    price: bestQuote.price,
  };

  return { ok: true, plan };
}

export class NoEligibleRouteError extends Error {
  constructor(
    public code: 'no_eligible_route' | 'floor_not_met' | 'all_quotes_expired',
    message: string
  ) {
    super(message);
    this.name = 'NoEligibleRouteError';
  }
}

export function throwIfNoRoute(result: SolverResult): Plan {
  if (result.ok) return result.plan;
  const details = 'details' in result ? ` (${result.details})` : '';
  throw new NoEligibleRouteError(result.error, `${result.error}${details}`);
}

// ─── solveWithFallback ────────────────────────────────────────────────────────

/** Maximum number of fallback re-solve attempts after the primary anchor fails. */
export const MAX_FALLBACK_ATTEMPTS = 2;

export type QuoteRejectionReason = 'expired' | 'rejected' | 'unavailable';

export interface SolveAttempt {
  anchorId: string;
  succeeded: boolean;
  rejectionReason?: QuoteRejectionReason;
  attemptedAt: string;
}

export interface SolveResult {
  winner: AnchorRate | null;
  comparison: RateComparison | null;
  attempts: SolveAttempt[];
}

async function fetchBestRate(
  corridorId: string,
  amount: string,
  excludeIds: Set<string>
): Promise<{ winner: AnchorRate; comparison: RateComparison } | null> {
  const settled = await fetchAllAnchorFees(amount, corridorId);

  const filtered = settled.map((result): PromiseSettledResult<AnchorRate> => {
    if (result.status === 'fulfilled' && excludeIds.has(result.value.anchorId)) {
      return { status: 'rejected', reason: new Error(`Anchor ${result.value.anchorId} excluded`) };
    }
    return result;
  });

  const comparison = computeRateComparison(filtered, corridorId);
  if (!comparison.bestRateId) return null;

  const winner = comparison.rates.find((r) => r.anchorId === comparison.bestRateId);
  if (!winner) return null;

  return { winner, comparison };
}

/**
 * Solves for the best anchor for a given corridor and amount.
 * Re-solves with fallback anchors if the primary quote is rejected, up to
 * MAX_FALLBACK_ATTEMPTS times.
 */
export async function solveWithFallback(
  corridorId: string,
  amount: string,
  isRejected: (rate: AnchorRate) => boolean = () => false
): Promise<SolveResult> {
  const attempts: SolveAttempt[] = [];
  const excludeIds = new Set<string>();
  const maxRounds = 1 + MAX_FALLBACK_ATTEMPTS;

  for (let round = 0; round < maxRounds; round++) {
    const result = await fetchBestRate(corridorId, amount, excludeIds);
    if (!result) break;

    const { winner, comparison } = result;
    const rejected = isRejected(winner);

    attempts.push({
      anchorId: winner.anchorId,
      succeeded: !rejected,
      ...(rejected && { rejectionReason: 'rejected' as QuoteRejectionReason }),
      attemptedAt: new Date().toISOString(),
    });

    if (!rejected) return { winner, comparison, attempts };

    excludeIds.add(winner.anchorId);
  }

  return { winner: null, comparison: null, attempts };
}
