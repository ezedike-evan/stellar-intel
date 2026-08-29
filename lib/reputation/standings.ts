/**
 * Standings presentation rules for /anchors/standings.
 *
 * These lived inline in the page component, which is an async server component
 * and therefore not reachable from vitest. The empty-sample rule is a
 * correctness rule rather than a styling one — an anchor with no recorded
 * outcomes must not be labelled "poor" and must not hold first place — so it
 * belongs somewhere it can be asserted. See tests/standings-ranking.spec.ts.
 */

/** The two fields the ranking and labelling rules actually read. */
export interface RankableStanding {
  composite: number;
  sampleSize: number;
}

/**
 * An anchor is measured once it has at least one recorded outcome. Everything
 * below turns on this: a zero-sample anchor has not performed badly, it has not
 * performed at all, and a score computed from nothing ranks on priors.
 */
export function isMeasured(sampleSize: number): boolean {
  return sampleSize > 0;
}

/**
 * Verdict text and colour token for a composite score.
 *
 * A zero-sample anchor gets its own label rather than falling through to
 * "poor", which is what a 0 composite would otherwise produce.
 */
export function scoreLabel(
  score: number,
  sampleSize: number
): { label: string; className: string } {
  if (!isMeasured(sampleSize)) return { label: 'not yet measured', className: 'text-fg-muted' };
  if (score >= 0.8) return { label: 'excellent', className: 'text-status-up' };
  if (score >= 0.6) return { label: 'good', className: 'text-secondary-text' };
  if (score >= 0.4) return { label: 'fair', className: 'text-status-unknown' };
  return { label: 'poor', className: 'text-status-down' };
}

/**
 * Order the table and number the anchors that have actually been measured.
 *
 * Measured anchors sort first, descending by composite, and take ranks 1..m.
 * Unmeasured anchors follow in registry order with `rank: null`, because a
 * position in a list is a claim about performance and there is nothing to
 * claim. `Array.prototype.sort` is stable, so ties keep registry order.
 *
 * Ranking every row and hiding the number at render time is what this used to
 * do, and it let an unmeasured anchor consume rank 1: `weightedComposite` is
 * clamped to `[0, 1]`, so an anchor that is measured and failing completely
 * scores exactly 0 and ties every unmeasured row. Registry order then decided
 * first place, and nothing showed `#1` at all.
 */
export function rankStandings<T extends RankableStanding>(
  entries: T[]
): (T & { rank: number | null })[] {
  // `rank` last in both spreads: a row that already carries one is being
  // re-ranked, and the computed value has to win.
  const measured = entries
    .filter((entry) => isMeasured(entry.sampleSize))
    .sort((a, b) => b.composite - a.composite)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const unmeasured = entries
    .filter((entry) => !isMeasured(entry.sampleSize))
    .map((entry) => ({ ...entry, rank: null }));

  return [...measured, ...unmeasured];
}

/**
 * Only a measured anchor can hold first place. `rankStandings` already refuses
 * to number an unmeasured row, and the `isMeasured` check keeps that true for
 * any caller that builds its rows some other way.
 */
export function holdsTopRank(entry: { rank: number | null; sampleSize: number }): boolean {
  return entry.rank === 1 && isMeasured(entry.sampleSize);
}
