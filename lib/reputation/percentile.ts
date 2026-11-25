/**
 * Nearest-rank percentile of an ascending-sorted array (the caller sorts).
 * rank = ceil(p/100 * n), 1-based, clamped to [1, n]. p = 0 returns the minimum.
 */
export function nearestRankPercentile(sorted: readonly number[], p: number): number | null {
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new RangeError('p must be a finite number in [0, 100]');
  }
  const n = sorted.length;
  if (n === 0) return null;
  const rank = Math.ceil((p / 100) * n) - 1;
  const index = Math.min(Math.max(rank, 0), n - 1);
  return sorted[index]!;
}
