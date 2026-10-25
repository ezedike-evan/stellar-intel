import type { OutcomeLogRow } from '@/types/reputation';
import { percentile } from './store';

export type QuoteGapWindowDays = 7 | 30 | 90;

export interface QuoteGapStats {
  /** Completed, undisputed withdrawals in the window that carry a delivered rate. */
  sampleCount: number;
  /** Mean of the signed gaps, in percent; negative means users landed less than quoted. */
  meanGapPct: number | null;
  /** Median signed gap, in percent. */
  p50GapPct: number | null;
  /** 95th percentile of the absolute gap, in percent: 95% landed within this. */
  p95AbsGapPct: number | null;
  /** Transactions that landed below the quote. */
  worseCount: number;
  /** Transactions that landed above the quote. */
  betterCount: number;
  windowDays: QuoteGapWindowDays;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far an anchor's landed rate drifts from the rate it showed, as a signed
 * percentage per transaction: `(delivered - quoted) / quoted * 100`.
 *
 * It stands in for SEP-38 firm quotes, which most anchors do not offer. Unlike the
 * scorecard's slippage it is not clamped at zero, so an anchor that delivers better
 * than quoted shows up, and the mean and median show whether the gap is biased one
 * way. Only completed, undisputed withdrawals with a delivered rate count; deposits
 * are measured on a different basis and are left out. Rows with a missing, zero or
 * non-numeric rate are skipped rather than counted as a zero gap.
 */
export function computeQuoteGapStats(
  rows: readonly OutcomeLogRow[],
  opts: { windowDays: QuoteGapWindowDays; now?: number }
): QuoteGapStats {
  const { windowDays } = opts;
  const cutoff = (opts.now ?? Date.now()) - windowDays * DAY_MS;

  const gaps: number[] = [];
  for (const row of rows) {
    if (row.outcome !== 'completed' || row.disputed || row.direction === 'deposit') continue;
    if (row.deliveredRate === null) continue;
    const created = Date.parse(row.createdAt);
    if (!Number.isFinite(created) || created < cutoff) continue;

    const quoted = Number(row.quotedRate);
    const delivered = Number(row.deliveredRate);
    if (!Number.isFinite(quoted) || quoted <= 0 || !Number.isFinite(delivered)) continue;

    gaps.push(((delivered - quoted) / quoted) * 100);
  }

  if (gaps.length === 0) {
    return {
      sampleCount: 0,
      meanGapPct: null,
      p50GapPct: null,
      p95AbsGapPct: null,
      worseCount: 0,
      betterCount: 0,
      windowDays,
    };
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const sortedAbs = gaps.map(Math.abs).sort((a, b) => a - b);

  return {
    sampleCount: gaps.length,
    meanGapPct: gaps.reduce((sum, g) => sum + g, 0) / gaps.length,
    p50GapPct: percentile(sorted, 50),
    p95AbsGapPct: percentile(sortedAbs, 95),
    worseCount: gaps.filter((g) => g < 0).length,
    betterCount: gaps.filter((g) => g > 0).length,
    windowDays,
  };
}
