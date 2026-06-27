// Fallback to 30 if the environment variable is not set
export const MIN_OUTCOMES_THRESHOLD = parseInt(process.env.NEXT_PUBLIC_MIN_OUTCOMES || '30', 10);

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
