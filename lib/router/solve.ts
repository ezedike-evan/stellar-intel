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
  MultiAnchorPlan,
  MultiSolverResult,
  Plan,
  PlanLeg,
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
  const sRate = maxRate > 0 ? Math.max(0, rate / maxRate) : 0;
  const sReputation = Math.max(0, Math.min(1.0, reputationComposite));
  const sReliability = Math.max(0, Math.min(1.0, reliability));
  const sLatency = Math.max(0, Math.min(1.0, 1 - latencyMs / NORM_LATENCY_MS));

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
 * under `scored` it scores quotes on rate, reliability, latency, and
 * reputation when metrics are supplied, falling back to the highest buy_amount
 * (rate) when they are not; under `first-match` the first eligible quote wins.
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
    // Explicit opt-in to legacy first-match behavior
  } else if (scoring && scoring.anchorMetrics) {
    const weights = { ...DEFAULT_SCORING_WEIGHTS, ...scoring.weights };

    // Find the max buy amount among valid quotes for relative rate normalization
    let maxBuyAmountBig = 0n;
    for (const q of validQuotes) {
      const amt = parseDecimal(q.buy_amount);
      if (amt > maxBuyAmountBig) {
        maxBuyAmountBig = amt;
      }
    }
    const maxRate = Number(maxBuyAmountBig);

    let highestScore = -1;
    for (const quote of validQuotes) {
      const metrics = scoring.anchorMetrics[quote.anchorId];
      const rate = Number(parseDecimal(quote.buy_amount));
      const reliability = metrics?.reliability ?? 1.0;
      const latencyMs = metrics?.latencyMs ?? 500;
      const reputationComposite = metrics?.reputationComposite ?? 1.0;

      const score = computeRoutingScore(
        rate,
        maxRate,
        reliability,
        latencyMs,
        reputationComposite,
        weights
      );

      if (score > highestScore) {
        highestScore = score;
        bestQuote = quote;
      } else if (Math.abs(score - highestScore) < 1e-9) {
        // Break ties by preferring higher buy_amount (better rate)
        if (compareDecimals(quote.buy_amount, bestQuote.buy_amount) > 0) {
          bestQuote = quote;
        }
      }
    }
  } else {
    // Fall back to pure rate solver (highest buy_amount)
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

// ─── solveMultiAnchor (issue #800) ─────────────────────────────────────────────

/** Renders a 7-dp-scaled BigInt back to a trimmed decimal string. */
function formatDecimal(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(8, '0');
  const intPart = digits.slice(0, -7);
  const fracPart = digits.slice(-7).replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${fracPart ? `.${fracPart}` : ''}`;
}

export interface MultiAnchorOptions {
  /** Cap on the number of anchors the order may be split across. */
  maxAnchors?: number;
}

/**
 * Splits an order across multiple anchors, best price first, so a large order
 * that no single anchor can fill cheaply is routed as tranches. Each anchor
 * absorbs up to the size its firm quote covers (`sell_amount`); the strategy
 * walks the price-ranked quotes, filling the remaining amount until the order is
 * satisfied. The resulting legs are meant to execute as ONE atomic multi-op
 * Stellar transaction (see `lib/router/multi-op.ts`), so either every leg
 * settles or none do — a partial fill can never strand funds at one anchor.
 *
 * Returns a typed error when the combined liquidity can't fill the order or the
 * aggregate delivered amount would miss the intent floor.
 */
export function solveMultiAnchor(
  intent: Intent,
  evaluatedQuotes: EvaluatedQuote[],
  options: MultiAnchorOptions = {}
): MultiSolverResult {
  if (isDeadlineExpired(intent.deadline)) {
    return {
      ok: false,
      error: 'all_quotes_expired',
      details: `Intent deadline ${intent.deadline} has already passed`,
    };
  }

  const live = evaluatedQuotes.filter((q) => !isQuoteExpired(q.expires_at));
  if (live.length === 0) {
    if (evaluatedQuotes.length === 0) return { ok: false, error: 'no_eligible_route' };
    return {
      ok: false,
      error: 'all_quotes_expired',
      details: `All ${evaluatedQuotes.length} quote(s) have expired`,
    };
  }

  const maxAnchors = Math.max(
    1,
    options.maxAnchors ?? intent.preferences?.maxAnchors ?? live.length
  );

  // Rank by price (buy per unit sold) descending — best rate for the user first.
  const ranked = [...live].sort((a, b) => compareDecimals(b.price, a.price));

  const target = parseDecimal(intent.sellAmount);
  let remaining = target;
  const legs: PlanLeg[] = [];

  for (const quote of ranked) {
    if (remaining <= 0n || legs.length >= maxAnchors) break;

    const capacity = parseDecimal(quote.sell_amount);
    if (capacity <= 0n) continue;

    const alloc = capacity < remaining ? capacity : remaining;
    const price = parseDecimal(quote.price);
    // buy = sell * price; both are 7-dp scaled, so divide out one scale factor.
    const netScaled = (alloc * price) / DECIMAL_SCALE;
    // Fee is prorated by the fraction of the quote's size this leg consumes.
    const legFee = (parseDecimal(quote.fee.total) * alloc) / capacity;

    legs.push({
      anchorId: quote.anchorId,
      anchorName: quote.anchorName,
      quoteId: quote.id,
      sellAmount: formatDecimal(alloc),
      netAmount: formatDecimal(netScaled),
      fee: formatDecimal(legFee),
      price: quote.price,
    });

    remaining -= alloc;
  }

  if (remaining > 0n) {
    return {
      ok: false,
      error: 'insufficient_liquidity',
      details: `Combined anchor liquidity covers ${formatDecimal(target - remaining)} of ${intent.sellAmount} ${intent.sellAsset.code} (max ${maxAnchors} anchors)`,
    };
  }

  const totalSellScaled = legs.reduce((sum, leg) => sum + parseDecimal(leg.sellAmount), 0n);
  const netScaledTotal = legs.reduce((sum, leg) => sum + parseDecimal(leg.netAmount), 0n);

  if (netScaledTotal < parseDecimal(intent.minReceive)) {
    return {
      ok: false,
      error: 'floor_not_met',
      details: `Aggregate delivered ${formatDecimal(netScaledTotal)} < minimum receive ${intent.minReceive}`,
    };
  }

  const plan: MultiAnchorPlan = {
    type: 'multi_anchor',
    legs,
    totalSell: formatDecimal(totalSellScaled),
    netAmount: formatDecimal(netScaledTotal),
  };

  log.info(
    {
      corridor: intent.corridor,
      anchors: legs.length,
      totalSell: plan.totalSell,
      netAmount: plan.netAmount,
    },
    'multi-anchor routing decision'
  );

  return { ok: true, plan };
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

// ─── Hop chain abstraction (Issue #815) ──────────────────────────────────────
//
// Primitive II: on-ramp → swap → yield in one signature.
// Each module type implements HopExecutor; solveChain validates asset continuity
// and delegates planning to registered executors — no connector implementations
// live here.

export type HopKind = 'on-ramp' | 'swap' | 'yield';

/** Minimal asset identifier used for hop-to-hop continuity checks. */
export interface HopAssetRef {
  code: string;
  issuer?: string;
}

/** One composable step in a chained execution. */
export interface Hop {
  kind: HopKind;
  /** Asset this hop consumes. */
  sellAsset: HopAssetRef;
  /** Asset this hop produces. */
  buyAsset: HopAssetRef;
  /** Minimum acceptable output from this hop. */
  minReceive: string;
}

/** A hop resolved to a concrete executor with estimated amounts. */
export interface PlannedHop {
  hop: Hop;
  /** Stable executor id: anchorId for on-ramp, poolId for swap, protocolId for yield. */
  executorId: string;
  /** Estimated net output (after fees) from this hop. */
  estimatedOut: string;
  fee: string;
}

/** Execution plan produced when every hop in a chain is solved. */
export interface ChainedPlan {
  type: 'chained';
  hops: PlannedHop[];
  /** Estimated net output of the final hop — what the user actually receives. */
  totalEstimatedOut: string;
}

/** Discriminated-union result of attempting to solve a hop chain. */
export type ChainSolverResult =
  | { ok: true; plan: ChainedPlan }
  | { ok: false; error: 'empty_chain' }
  | { ok: false; error: 'asset_mismatch'; hopIndex: number; details: string }
  | { ok: false; error: 'no_route_for_hop'; hopIndex: number; details: string };

/**
 * Contract every hop connector (on-ramp, swap, yield) must implement.
 * The solver calls `planHop` for each hop in the chain; returning `null`
 * signals that this executor cannot serve the hop and the solver tries the next.
 */
export interface HopExecutor {
  readonly kind: HopKind;
  readonly executorId: string;
  planHop(hop: Hop): Promise<PlannedHop | null>;
}

function assetsMatch(a: HopAssetRef, b: HopAssetRef): boolean {
  if (a.code.toUpperCase() !== b.code.toUpperCase()) return false;
  if (a.issuer && b.issuer && a.issuer !== b.issuer) return false;
  return true;
}

function assetLabel(a: HopAssetRef): string {
  return a.issuer ? `${a.code}:${a.issuer.slice(0, 8)}` : a.code;
}

function validateHopChain(hops: Hop[]): ChainSolverResult | null {
  if (hops.length === 0) return { ok: false, error: 'empty_chain' };
  for (let i = 1; i < hops.length; i++) {
    const prev = hops[i - 1]!;
    const curr = hops[i]!;
    if (!assetsMatch(prev.buyAsset, curr.sellAsset)) {
      return {
        ok: false,
        error: 'asset_mismatch',
        hopIndex: i,
        details: `hop[${i - 1}] (${prev.kind}) outputs ${assetLabel(prev.buyAsset)} but hop[${i}] (${curr.kind}) expects ${assetLabel(curr.sellAsset)}`,
      };
    }
  }
  return null;
}

/**
 * Plans a chain of hops against a registry of executors.
 *
 * Asset continuity is validated before any executor is called. Hops are planned
 * left-to-right; the first executor of the matching kind that returns a non-null
 * plan wins. Returns a typed error if any hop cannot be routed.
 */
export async function solveChain(
  hops: Hop[],
  executors: HopExecutor[]
): Promise<ChainSolverResult> {
  const chainError = validateHopChain(hops);
  if (chainError) return chainError;

  const plannedHops: PlannedHop[] = [];

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i]!;
    const eligible = executors.filter((e) => e.kind === hop.kind);

    let planned: PlannedHop | null = null;
    for (const executor of eligible) {
      planned = await executor.planHop(hop);
      if (planned) break;
    }

    if (!planned) {
      return {
        ok: false,
        error: 'no_route_for_hop',
        hopIndex: i,
        details: `no executor for hop[${i}] (${hop.kind}: ${assetLabel(hop.sellAsset)} -> ${assetLabel(hop.buyAsset)})`,
      };
    }

    plannedHops.push(planned);
  }

  const lastHop = plannedHops[plannedHops.length - 1]!;
  return {
    ok: true,
    plan: { type: 'chained', hops: plannedHops, totalEstimatedOut: lastHop.estimatedOut },
  };
}
