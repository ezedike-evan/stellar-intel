/**
 * Normalization reference: settlement time considered "baseline fast".
 * A settle at or below this value yields a ratio ≥ 1 in the formula.
 */
export const NORM_SETTLE_SECONDS = 300;

/**
 * Guard against divide-by-zero for anchors with zero reported settle time.
 */
export const MIN_SETTLE_SECONDS = 1;

export interface CompositeMetrics {
  fillRate: number; // fraction [0, 1]
  slippage: number; // fractional slippage [0, 1], e.g. 0.011 for 1.1 %
  settleSeconds: number; // median settlement time in seconds (positive)
}

/**
 * Composite score formula: fillRate × (1 − slippage) ÷ normalizedSettle
 *
 * normalizedSettle = settleSeconds / NORM_SETTLE_SECONDS
 *
 * A score of 1.0 means perfect fill, zero slippage, at exactly the reference
 * settle time. Values > 1 indicate faster-than-reference settlement.
 */
export function composite(metrics: CompositeMetrics): number {
  const { fillRate, slippage, settleSeconds } = metrics;
  const safeSettle = Math.max(settleSeconds, MIN_SETTLE_SECONDS);
  const normalizedSettle = safeSettle / NORM_SETTLE_SECONDS;
  return (fillRate * (1 - slippage)) / normalizedSettle;
}

// ─── Display-ranking score (#917) ──────────────────────────────────────────────
//
// A SECOND formula, and deliberately kept distinct rather than merged into
// `composite` above.
//
// `composite` is the canonical score: it matches `docs/ANCHOR_REPUTATION.md`
// and `contracts/reputation/src/score.rs::compute_composite_bps`, so it is what
// the oracle publishes on-chain and what a third party verifies against. It is
// unbounded — above 1 means faster than the reference settle time.
//
// `weightedComposite` is what the leaderboard, the standings page and rate
// ranking have always used. It is a clamped weighted sum, so it stays in [0, 1]
// and reads naturally as a percentage in a UI, but it is NOT the published
// formula and produces different orderings.
//
// Until #917's follow-up decides which one the product means, both exist here
// under names that say what they are. Previously this function was copy-pasted
// into three files with no indication that it differed from `composite` at all,
// so the leaderboard and the on-chain oracle could disagree about an anchor
// without anyone noticing.

/** Weight applied to fill rate in `weightedComposite`. */
export const WEIGHT_FILL = 0.4;
/** Weight applied to the slippage term. */
export const WEIGHT_SLIPPAGE = 0.3;
/** Weight applied to the settlement-time term. */
export const WEIGHT_SETTLE = 0.3;
/** Slippage at or above this counts as a zero score for that term. */
export const SLIPPAGE_CEILING = 0.05;

/**
 * Clamped weighted score in `[0, 1]`, used for display and ranking.
 *
 * Not the published formula — see `composite` for that.
 */
export function weightedComposite(
  fillRate: number,
  settleSeconds: number,
  slippage: number
): number {
  const fillScore = Math.min(1, Math.max(0, fillRate));
  const slippageScore = Math.min(1, Math.max(0, 1 - slippage / SLIPPAGE_CEILING));
  const settleScore = Math.min(1, Math.max(0, 1 - settleSeconds / NORM_SETTLE_SECONDS));

  const raw =
    WEIGHT_FILL * fillScore + WEIGHT_SLIPPAGE * slippageScore + WEIGHT_SETTLE * settleScore;
  // Rounded to 4 dp to keep API payloads compact and stable.
  return Math.round(raw * 10_000) / 10_000;
}
