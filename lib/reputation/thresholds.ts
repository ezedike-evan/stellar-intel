// Fallback to 30 if the environment variable is not set
export const MIN_OUTCOMES_THRESHOLD = parseInt(process.env.NEXT_PUBLIC_MIN_OUTCOMES || '30', 10);

// ─── Quote drift (Issue #D006) ─────────────────────────────────────────────────
//
// How far an anchor's quote may deviate from the cross-anchor median for the
// same corridor/amount before the quote-drift probe flags it. Flagging is
// informational only — a drifted anchor is never auto-excluded.

// Fallback to 3% if the environment variable is not set
export const DRIFT_THRESHOLD_PERCENT = parseFloat(process.env.QUOTE_DRIFT_THRESHOLD_PERCENT || '3');

/**
 * True when a quote's percentage deviation from the cross-anchor median
 * exceeds the configured (or given) drift threshold.
 */
export function isDrifted(
  deviationPercent: number,
  threshold: number = DRIFT_THRESHOLD_PERCENT
): boolean {
  return Math.abs(deviationPercent) > threshold;
}

/**
 * Checks if the anchor has met the minimum required outcomes.
 */
export function hasEnoughData(currentCount: number): boolean {
  return currentCount >= MIN_OUTCOMES_THRESHOLD;
}

/**
 * Estimates the time to reach the threshold.
 * @param currentCount The current number of recorded outcomes
 * @param dailyRate Estimated new outcomes per day (default 1)
 */
export function estimateTimeToThreshold(currentCount: number, dailyRate: number = 1): string {
  const remaining = MIN_OUTCOMES_THRESHOLD - currentCount;

  if (remaining <= 0) return 'Ready';

  const days = Math.ceil(remaining / dailyRate);

  if (days === 1) return '~1 day';
  if (days < 7) return `~${days} days`;

  const weeks = Math.ceil(days / 7);
  return `~${weeks} week${weeks > 1 ? 's' : ''}`;
}
