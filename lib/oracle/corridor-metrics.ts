import type { OutcomeLogRow } from '@/types/reputation';

/**
 * lib/oracle/corridor-metrics.ts
 *
 * Off-chain feed for the contract's `set_corridor_metrics` (#1401): derives, for
 * every (anchor, corridor) pair with outcomes, the figures the on-chain
 * composite score is computed from. The counterpart of `corridor-rate.ts`, which
 * feeds `publish_corridor_rate`.
 */

/**
 * One pair's metrics, ready for the publisher.
 *
 * Structural, matching `CorridorMetricsInput` in `packages/publisher`, for the
 * same reason `CorridorRatePublish` is: the app consumes that package, so
 * importing its types here would invert the dependency.
 */
export interface CorridorMetricsPublish {
  anchorId: string;
  corridor: string;
  /** Share of outcomes that completed, in basis points. */
  fillRateBps: number;
  /** Median shortfall of delivered against quoted, in basis points. */
  slippageBps: number;
  /** Median settle time of completed outcomes, in seconds. */
  settleSecondsP50: number;
  /** How many outcomes the figures are derived from. */
  n: number;
}

/** The fields the derivation reads; a full {@link OutcomeLogRow} satisfies it. */
type MetricsRow = Pick<
  OutcomeLogRow,
  'anchorId' | 'corridor' | 'outcome' | 'quotedRate' | 'deliveredRate' | 'settleSeconds'
>;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Basis points the delivered rate fell short of the quote; 0 when it beat it. */
function slippageBps(row: MetricsRow): number | null {
  if (row.deliveredRate === null) return null;
  const quoted = Number(row.quotedRate);
  const delivered = Number(row.deliveredRate);
  if (!(quoted > 0) || !(delivered > 0)) return null;
  return Math.max(0, ((quoted - delivered) / quoted) * 10_000);
}

function deriveGroup(
  rows: readonly MetricsRow[]
): Omit<CorridorMetricsPublish, 'anchorId' | 'corridor'> {
  const completed = rows.filter((r) => r.outcome === 'completed');

  const slippages = completed.map(slippageBps).filter((value): value is number => value !== null);
  const settles = completed
    .map((r) => r.settleSeconds)
    .filter((value): value is number => value !== null);

  return {
    fillRateBps: Math.round((completed.length / rows.length) * 10_000),
    slippageBps: slippages.length > 0 ? Math.round(median(slippages)) : 0,
    settleSecondsP50: settles.length > 0 ? Math.round(median(settles)) : 0,
    n: rows.length,
  };
}

/**
 * Derives publishable metrics for every (anchor, corridor) pair in `rows`.
 *
 * - `n` is the number of rows in the pair.
 * - `fillRateBps` is the share with `outcome === 'completed'`, in basis points.
 * - `slippageBps` is the median, over completed rows with a quoted rate and a
 *   delivered rate above zero, of how far delivered fell short of quoted (a
 *   delivered rate above the quote counts as 0, not negative); 0 with no such rows.
 * - `settleSecondsP50` is the median `settleSeconds` of completed rows, ignoring
 *   nulls; 0 with none.
 *
 * Pairs come out in the order they first appear in `rows`.
 */
export function deriveCorridorMetrics(rows: readonly MetricsRow[]): CorridorMetricsPublish[] {
  const groups = new Map<string, { anchorId: string; corridor: string; rows: MetricsRow[] }>();
  for (const row of rows) {
    // A separator that cannot appear in an id keeps ('a', 'b-c') apart from ('a-b', 'c').
    const key = `${row.anchorId}\u0000${row.corridor}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { anchorId: row.anchorId, corridor: row.corridor, rows: [row] });
  }

  return [...groups.values()].map((group) => ({
    anchorId: group.anchorId,
    corridor: group.corridor,
    ...deriveGroup(group.rows),
  }));
}
