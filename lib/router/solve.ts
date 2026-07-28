/**
 * lib/router/solve.ts
 *
 * Intent router — two complementary solvers:
 *   - solveSingleAnchor: picks the best SEP-38 quote meeting floor + deadline (issue #119)
 *   - solveWithFallback: rate-based fallback re-solve across SEP-24 anchors (issue #215)
 */

import { env } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { fetchAllAnchorFees, computeRateComparison } from '@/lib/stellar/sep24';
import type {
  AnchorRate,
  EvaluatedQuote,
  Intent,
  Plan,
  RateComparison,
  SolverResult,
} from '@/types';

const log = getLogger('router/solve');

/**
 * Routing strategies, gated by the ROUTING_STRATEGY environment flag (issue #730).
 *
 * - `first-match`: pick the first eligible quote in candidate order. Cheap and
 *   fully deterministic; the safe default until the scored solver is validated.
 * - `scored`: pick by the multi-factor routing score when metrics are supplied,
 *   otherwise by best rate (highest buy_amount).
 *
 * Rollout can be reverted at any time by flipping the flag back to `first-match`.
 */
export type RoutingStrategy = 'first-match' | 'scored';

// ─── solveSingleAnchor ────────────────────────────────────────────────────────

/**
 * Compares two decimal strings numerically.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 *
 * Uses BigInt scaled to 7 decimal places to avoid float precision loss on
 * large financial amounts.
 */
const DECIMAL_SCALE = 10n ** 7n;

export const TypedError = {
  FeeBudgetExceeded: 'fee_budget_exceeded' as const,
} as const;

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
  const shift = 7 - pointFromRight; // scale to 7 decimal places
  const magnitude =
    shift >= 0 ? BigInt(digits) * 10n ** BigInt(shift) : BigInt(digits) / 10n ** BigInt(-shift);
  return sign * magnitude;
}

function compareDecimals(a: string, b: string): number {
  const bigA = parseDecimal(a);
  const bigB = parseDecimal(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

function exceedsFeeBudget(quote: EvaluatedQuote, budgetPct: number): boolean {
  if (budgetPct >= 100) return false;
  if (compareDecimals(quote.sell_amount, '0') === 0) return false;

  const feeScaled = parseDecimal(quote.fee.total);
  const sellScaled = parseDecimal(quote.sell_amount);
  const budgetScaled = parseDecimal(String(budgetPct));

  return feeScaled * 100n * DECIMAL_SCALE > sellScaled * budgetScaled;
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

// ─── Multi-Factor Routing Scoring ─────────────────────────────────────────────

/**
 * Scoring inputs for multi-factor solver routing.
 * Separates rating (pricing), probe reliability (uptime/availability), quote latency,
 * and transaction outcomes (reputation composite score).
 */
export interface ScoringInputs {
  /** Map of anchorId to its historical/performance metrics */
  anchorMetrics?: Record<
    string,
    {
      /** Historical probe reachability/uptime score in [0, 1] */
      reliability?: number;
      /** Rolling p50 or average quote latency in milliseconds */
      latencyMs?: number;
      /** Transaction-based composite reputation score from lib/reputation/composite.ts */
      reputationComposite?: number;
    }
  >;
  /** Custom weights to override the default routing behavior */
  weights?: {
    rate?: number;
    reputation?: number;
    reliability?: number;
    latency?: number;
  };
}

/**
 * Default weights for the multi-factor routing score.
 *
 * - Rate (50%): Primary consideration, ensuring users get competitive rates.
 * - Reputation (30%): Incorporates real transaction fill rate, slippage, and settle time.
 * - Reliability (15%): Historical uptime/reachability to avoid down/flaky anchors.
 * - Latency (5%): Secondary factor to optimize for instant/fast user experiences.
 */
export const DEFAULT_SCORING_WEIGHTS = {
  rate: 0.5,
  reputation: 0.3,
  reliability: 0.15,
  latency: 0.05,
};

/** Normalization target for quote latency. Latencies >= this receive a score of 0. */
export const NORM_LATENCY_MS = 2000;

/**
 * Weighting Formula and Composition with Reputation:
 *
 * The routing score is a weighted sum of four normalized metrics:
 *   Score = w_rate * S_rate + w_reputation * S_reputation + w_reliability * S_reliability + w_latency * S_latency
 *
 * Metric Normalization:
 * 1. Rate Score (S_rate):
 *    Normalized relative to the highest (best) rate in the candidate set:
 *      S_rate = rate / maxRate
 *
 * 2. Reputation Score (S_reputation):
 *    Drawn from the transaction-based composite reputation score (lib/reputation/composite.ts):
 *      composite = fillRate * (1 - slippage) / (settleSeconds / NORM_SETTLE_SECONDS)
 *    Since this score is calculated relative to a reference settlement time (300s),
 *    values >= 1.0 are excellent (fast settlement). We cap the input at 1.0 to prevent
 *    a single ultra-fast settlement from overwhelming other routing criteria:
 *      S_reputation = clamp(0.0, 1.0, reputationComposite)
 *
 * 3. Reliability Score (S_reliability):
 *    Historical uptime/reachability fraction from probe data:
 *      S_reliability = clamp(0.0, 1.0, reliability)
 *
 * 4. Latency Score (S_latency):
 *    Linear decay from 0ms (score 1.0) to NORM_LATENCY_MS (score 0.0):
 *      S_latency = max(0, 1 - latencyMs / NORM_LATENCY_MS)
 *
 * By design:
 * - Decoupled: No absolute rate, corridor, or fiat code bounds are assumed.
 * - Normalized: All sub-scores range within [0, 1].
 */
export function computeRoutingScore(
  rate: number,
  maxRate: number,
  reliability: number = 1.0,
  latencyMs: number = 500,
  reputationComposite: number = 1.0,
  weights = DEFAULT_SCORING_WEIGHTS
): number {
  const sRate = maxRate > 0 ? rate / maxRate : 0;
  const sReputation = Math.max(0, Math.min(1.0, reputationComposite));
  const sReliability = Math.max(0, Math.min(1.0, reliability));
  const sLatency = Math.max(0, 1 - latencyMs / NORM_LATENCY_MS);

  const wRate = weights.rate ?? 0;
  const wReputation = weights.reputation ?? 0;
  const wReliability = weights.reliability ?? 0;
  const wLatency = weights.latency ?? 0;

  const totalWeight = wRate + wReputation + wReliability + wLatency;
  if (totalWeight === 0) return 0;

  const weightedSum =
    wRate * sRate + wReputation * sReputation + wReliability * sReliability + wLatency * sLatency;

  return weightedSum / totalWeight;
}

/**
 * Selects the best single-anchor SEP-38 quote that meets the intent's floor
 * and deadline constraints. Returns a typed discriminated-union result.
 *
 * Selection is gated by `strategy` (defaults to the ROUTING_STRATEGY flag):
 * under `first-match` the first eligible quote wins and scoring is skipped
 * entirely; under `scored` it scores quotes on rate, reliability, latency, and
 * reputation when metrics are supplied, falling back to the highest buy_amount
 * (rate) when they are not.
 */
export function solveSingleAnchor(
  intent: Intent,
  evaluatedQuotes: EvaluatedQuote[],
  feeBudgetPct: number = env.FEE_BUDGET_PCT,
  scoring?: ScoringInputs,
  strategy: RoutingStrategy = env.ROUTING_STRATEGY
): SolverResult {
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
  const feeBudgetViolations: EvaluatedQuote[] = [];

  for (const quote of evaluatedQuotes) {
    if (isQuoteExpired(quote.expires_at)) {
      expiredQuotes.push(quote);
    } else if (!meetsFloor(quote, intent)) {
      floorViolations.push(quote);
    } else if (exceedsFeeBudget(quote, feeBudgetPct)) {
      feeBudgetViolations.push(quote);
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
    if (feeBudgetViolations.length > 0) {
      const detail = feeBudgetViolations
        .map((q) => `${q.anchorName}: ${q.fee.total}/${q.sell_amount} ${intent.sellAsset.code}`)
        .join('; ');
      return {
        ok: false,
        error: TypedError.FeeBudgetExceeded,
        details: `No quotes satisfy fee budget of ${feeBudgetPct}%. ${detail}`,
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

  let bestQuote = validQuotes[0]!;

  if (strategy === 'first-match') {
    // Flag is off: keep the cheap deterministic path, ignore any scoring inputs.
  } else if (scoring && scoring.anchorMetrics) {
    const weights = { ...DEFAULT_SCORING_WEIGHTS, ...scoring.weights };

    // Find the max buy amount among valid quotes for relative rate normalization
    let maxBuyAmount = 0;
    for (const q of validQuotes) {
      const amt = Number(q.buy_amount);
      if (amt > maxBuyAmount) {
        maxBuyAmount = amt;
      }
    }

    let highestScore = -1;
    for (const quote of validQuotes) {
      const metrics = scoring.anchorMetrics[quote.anchorId];
      const rate = Number(quote.buy_amount);
      const reliability = metrics?.reliability ?? 1.0;
      const latencyMs = metrics?.latencyMs ?? 500;
      const reputationComposite = metrics?.reputationComposite ?? 1.0;

      const score = computeRoutingScore(
        rate,
        maxBuyAmount,
        reliability,
        latencyMs,
        reputationComposite,
        weights
      );

      if (score > highestScore) {
        highestScore = score;
        bestQuote = quote;
      }
    }
  } else {
    // Fall back to pure rate solver
    bestQuote = validQuotes.reduce((best, current) =>
      compareDecimals(current.buy_amount, best.buy_amount) > 0 ? current : best
    );
  }

  log.info(
    {
      strategy,
      corridor: intent.corridor,
      anchorId: bestQuote.anchorId,
      quoteId: bestQuote.id,
      candidates: validQuotes.length,
    },
    'routing decision'
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
    public code:
      | 'no_eligible_route'
      | 'floor_not_met'
      | 'all_quotes_expired'
      | 'fee_budget_exceeded',
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
