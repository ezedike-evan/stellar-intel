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
  fillRate: number;      // fraction [0, 1]
  slippage: number;      // fractional slippage [0, 1], e.g. 0.011 for 1.1 %
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
