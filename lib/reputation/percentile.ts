/**
 * Nearest-rank percentile over a sorted-ascending array.
 *
 * `rank = ceil(p / 100 * n)`, clamped to `[1, n]`, then read as a 0-based
 * index. A percentile is therefore always one of the observed values, never a
 * number between two of them. Returns `null` for an empty input.
 */
export function nearestRankPercentile(sortedValues: readonly number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedValues.length - 1);
  return sortedValues[index] ?? null;
}
