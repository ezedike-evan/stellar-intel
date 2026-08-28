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

// ─── Anchor health alerting (Issue #D016) ──────────────────────────────────────
//
// Probe cycles feed a debounced health state machine. An anchor only crosses
// into `degraded` after `DEGRADE_AFTER_FAILURES` *consecutive* failing cycles —
// the same consecutive-failure debounce the nightly auto-degrade ledger applies
// (`scripts/validate-anchors.mjs`, env `ANCHOR_DEGRADE_THRESHOLD`, default 3) —
// so a single flaky cycle never raises an alert. A longer streak escalates to
// `down`. Any clean cycle resets the streak.

export const HEALTH_STATUSES = ['healthy', 'degraded', 'down'] as const;
export type AnchorHealthStatus = (typeof HEALTH_STATUSES)[number];

// Fallback to 3 consecutive failures if the environment variable is not set.
// Shares ANCHOR_DEGRADE_THRESHOLD with the nightly validator so the probe and
// the ledger debounce on the same number.
export const DEGRADE_AFTER_FAILURES = parseInt(process.env.ANCHOR_DEGRADE_THRESHOLD || '3', 10);

// Fallback to twice the degrade threshold if the environment variable is not set.
export const DOWN_AFTER_FAILURES = parseInt(
  process.env.ANCHOR_DOWN_THRESHOLD || String(DEGRADE_AFTER_FAILURES * 2),
  10
);

// Fallback to 5000 ms if the environment variable is not set. A reachable but
// slower-than-budget quote counts as a latency-dimension failure.
export const LATENCY_BUDGET_MS = parseInt(process.env.PROBE_LATENCY_BUDGET_MS || '5000', 10);

/** Severity rank — higher is worse. Only used to compare two statuses. */
const STATUS_RANK: Record<AnchorHealthStatus, number> = { healthy: 0, degraded: 1, down: 2 };

/**
 * Composite health status implied by a streak of consecutive failing probe
 * cycles. Zero failures is `healthy`; the thresholds latch `degraded`, then
 * `down`. `downAfter` is floored at `degradeAfter` so a misconfigured pair can
 * never make `down` easier to reach than `degraded`.
 */
export function healthStatusFor(
  consecutiveFailures: number,
  degradeAfter: number = DEGRADE_AFTER_FAILURES,
  downAfter: number = DOWN_AFTER_FAILURES
): AnchorHealthStatus {
  if (consecutiveFailures >= Math.max(downAfter, degradeAfter)) return 'down';
  if (consecutiveFailures >= degradeAfter) return 'degraded';
  return 'healthy';
}

/**
 * True when `to` is strictly worse than `from` — healthy→degraded,
 * healthy→down, or degraded→down. Recoveries are `false`: this path alerts on
 * degradation only, and a latched status never re-alerts at the same level.
 */
export function isDegradingTransition(from: AnchorHealthStatus, to: AnchorHealthStatus): boolean {
  return STATUS_RANK[to] > STATUS_RANK[from];
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
