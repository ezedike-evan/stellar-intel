/**
 * Nearest-rank percentile computation over pre-sorted numeric values.
 *
 * Quotes values that actually occurred in the sample set rather than
 * interpolated estimates, matching the actuarial approach to SLA measurement.
 */
export function nearestRankPercentile(sortedValues: readonly number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedValues.length - 1);
  return sortedValues[index]!;
}
