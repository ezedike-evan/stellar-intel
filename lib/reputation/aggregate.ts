import type { OutcomeLogRow, ProbeLedgerRow } from '@/types/reputation';

export interface AggregateKey {
  anchorId: string;
  corridor: string;
}

export interface CorridorAggregate {
  anchorId: string;
  corridor: string;
  windowDays: 7 | 30 | 90;
  bucketStart: Date;
  txCount: number;
  successCount: number;
  avgSettlementMs: number | null;
  p50SettlementMs: number | null;
  p95SettlementMs: number | null;
  compositeScore: number | null;
  lastRefresh: Date;
}

export interface SettlementEvent {
  anchorId: string;
  corridor: string;
  completedAt: Date;
  settlementMs: number;
  success: boolean;
  disputed?: boolean;
}

export function computeCorridorAggregate(
  events: SettlementEvent[],
  anchorId: string,
  corridor: string,
  windowDays: 7 | 30 | 90,
  now = new Date()
): CorridorAggregate {
  const cutoff = new Date(now.getTime() - windowDays * 86400000);
  const relevant = events.filter(
    (e) =>
      e.anchorId === anchorId && e.corridor === corridor && e.completedAt >= cutoff && !e.disputed
  );

  const bucketStart = new Date(now);
  bucketStart.setUTCHours(0, 0, 0, 0);

  if (relevant.length === 0) {
    return {
      anchorId,
      corridor,
      windowDays,
      bucketStart,
      txCount: 0,
      successCount: 0,
      avgSettlementMs: null,
      p50SettlementMs: null,
      p95SettlementMs: null,
      compositeScore: null,
      lastRefresh: now,
    };
  }

  const successCount = relevant.filter((e) => e.success).length;
  // Robust outlier filtering using median and MAD
  const allTimes = relevant
    .filter((e) => e.success)
    .map((e) => e.settlementMs)
    .sort((a, b) => a - b);
  const median = allTimes.length > 0 ? percentile(allTimes, 50) : null;
  const mad =
    allTimes.length > 0
      ? percentile(
          allTimes.map((v) => Math.abs(v - (median as number))).sort((a, b) => a - b),
          50
        )
      : null;
  const filteredTimes =
    median !== null && mad !== null
      ? allTimes.filter((v) => Math.abs(v - (median as number)) <= 3 * (mad as number))
      : allTimes;
  const avgSettlementMs =
    filteredTimes.length > 0
      ? Math.round(filteredTimes.reduce((s, v) => s + v, 0) / filteredTimes.length)
      : null;
  const p50SettlementMs =
    filteredTimes.length > 0
      ? (filteredTimes[Math.floor(filteredTimes.length * 0.5)] ?? null)
      : null;
  const p95SettlementMs =
    filteredTimes.length > 0
      ? (filteredTimes[Math.floor(filteredTimes.length * 0.95)] ?? null)
      : null;

  const successRate = successCount / relevant.length;
  const speedScore = p50SettlementMs !== null ? Math.max(0, 1 - p50SettlementMs / 3600000) : 0;
  const compositeScore = Math.round((successRate * 0.7 + speedScore * 0.3) * 100) / 100;

  return {
    anchorId,
    corridor,
    windowDays,
    bucketStart,
    txCount: relevant.length,
    successCount,
    avgSettlementMs,
    p50SettlementMs,
    p95SettlementMs,
    compositeScore,
    lastRefresh: now,
  };
}

export function groupByCorridor(events: SettlementEvent[]): Map<string, SettlementEvent[]> {
  const map = new Map<string, SettlementEvent[]>();
  for (const e of events) {
    const key = `${e.anchorId}::${e.corridor}`;
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}

// ─── Per-anchor rolling window aggregates (#315) ──────────────────────────────

export interface AggregateWindow {
  anchorId: string;
  windowDays: 7 | 30 | 90;
  bucketStart: Date;
  txCount: number;
  successCount: number;
  avgSettlementMs: number | null;
  p50SettlementMs: number | null;
  p95SettlementMs: number | null;
  compositeScore: number | null;
}

function bucketStartFor(date: Date, windowDays: number): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const dayOfYear = Math.floor(
    (d.getTime() - new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).getTime()) / 86400000
  );
  d.setUTCDate(d.getUTCDate() - (dayOfYear % windowDays));
  return d;
}

export function computeWindowAggregate(
  events: SettlementEvent[],
  anchorId: string,
  windowDays: 7 | 30 | 90,
  now = new Date()
): AggregateWindow {
  const cutoff = new Date(now.getTime() - windowDays * 86400000);
  const relevant = events.filter(
    (e) => e.anchorId === anchorId && e.completedAt >= cutoff && !e.disputed
  );
  const bucketStart = bucketStartFor(now, windowDays);

  if (relevant.length === 0) {
    return {
      anchorId,
      windowDays,
      bucketStart,
      txCount: 0,
      successCount: 0,
      avgSettlementMs: null,
      p50SettlementMs: null,
      p95SettlementMs: null,
      compositeScore: null,
    };
  }

  const successCount = relevant.filter((e) => e.success).length;
  const times = relevant.map((e) => e.settlementMs).sort((a, b) => a - b);
  const avgSettlementMs = Math.round(times.reduce((s, v) => s + v, 0) / times.length);
  const p50SettlementMs = times[Math.floor(times.length * 0.5)] ?? null;
  const p95SettlementMs = times[Math.floor(times.length * 0.95)] ?? null;
  const successRate = successCount / relevant.length;
  const speedScore = p50SettlementMs !== null ? Math.max(0, 1 - p50SettlementMs / 3600000) : 0;
  const compositeScore = Math.round((successRate * 0.7 + speedScore * 0.3) * 100) / 100;

  return {
    anchorId,
    windowDays,
    bucketStart,
    txCount: relevant.length,
    successCount,
    avgSettlementMs,
    p50SettlementMs,
    p95SettlementMs,
    compositeScore,
  };
}

export function incrementalUpdate(
  current: AggregateWindow,
  newEvent: SettlementEvent
): AggregateWindow {
  const txCount = current.txCount + 1;
  const successCount = current.successCount + (newEvent.success ? 1 : 0);
  const avgSettlementMs =
    current.avgSettlementMs !== null
      ? Math.round((current.avgSettlementMs * current.txCount + newEvent.settlementMs) / txCount)
      : newEvent.settlementMs;
  const successRate = successCount / txCount;
  const speedScore =
    current.p50SettlementMs !== null ? Math.max(0, 1 - current.p50SettlementMs / 3600000) : 0;
  const compositeScore = Math.round((successRate * 0.7 + speedScore * 0.3) * 100) / 100;
  return { ...current, txCount, successCount, avgSettlementMs, compositeScore };
}

// ─── Percentile scorecards (issue #132) ───────────────────────────────────────
// Outcome-row → rolling 7/30/90-day scorecards with p50/p95 settlement latency.
// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * Maps raw `outcome_log` rows (as returned by ReputationStore.query) into the
 * flat OutcomeRow shape buildScorecards/aggregate operate on. Shared by the
 * per-anchor detail page and the leaderboard route so both compute scores the
 * same way from the same source of truth.
 */
export function mapOutcomeRows(rows: OutcomeLogRow[]): OutcomeRow[] {
  return rows.map((row) => ({
    intentHash: row.intentHash,
    anchorId: row.anchorId,
    filled: row.outcome === 'completed',
    settleMs: row.settleSeconds !== null ? row.settleSeconds * 1000 : null,
    slippage:
      row.deliveredRate !== null
        ? Math.max(0, 1 - Number.parseFloat(row.deliveredRate) / Number.parseFloat(row.quotedRate))
        : null,
    recordedAt: new Date(row.createdAt).getTime(),
  }));
}

/**
 * A single outcome row written to the reputation log after a transaction
 * completes. All PII has already been stripped (see redact.ts).
 */
export interface OutcomeRow {
  intentHash: string;
  anchorId: string;
  /** Whether the transaction reached the "completed" state. */
  filled: boolean;
  /** Settlement time in milliseconds (null when not yet settled). */
  settleMs: number | null;
  /** Slippage as a decimal fraction, e.g. 0.02 = 2 % (null when unavailable). */
  slippage: number | null;
  /** Unix timestamp (ms) when the row was recorded. */
  recordedAt: number;
  /** When true the row is excluded from all aggregate computations (#164/#168). */
  disputed?: boolean;
  trimmed?: boolean;
}

/** Rolling window in days — 7, 30, or 90. */
export type Window = 7 | 30 | 90;

// ─── Scorecard ────────────────────────────────────────────────────────────────

export interface Percentiles {
  p50: number;
  p95: number;
}

/**
 * The computed scorecard for one rolling window.
 * When there are fewer than MIN_SAMPLES rows the state is "insufficient_data".
 */
export type Scorecard =
  | {
      state: 'ok';
      window: Window;
      sampleSize: number;
      fillRate: number;
      settleMs: Percentiles;
      slippage: Percentiles;
      /** ISO 8601 timestamp when this scorecard was computed. */
      computedAt: string;
      /** ISO 8601 timestamp of last publisher transaction that mirrored this aggregate to Soroban, or null if not yet published. */
      lastPublisherTxTimestamp: string | null;
    }
  | {
      state: 'insufficient_data';
      window: Window;
      sampleSize: number;
      /** ISO 8601 timestamp when this scorecard was computed. */
      computedAt: string;
      /** ISO 8601 timestamp of last publisher transaction that mirrored this aggregate to Soroban, or null if not yet published. */
      lastPublisherTxTimestamp: string | null;
    };

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum rows required to compute a scorecard. */
export const MIN_SAMPLES = 1;

const MS_PER_DAY = 86_400_000;
// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the p-th percentile (0–100) of a sorted numeric array.
 * Uses linear interpolation (same as NumPy's default).
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * (idx - lo);
}

// ─── Core aggregate function ──────────────────────────────────────────────────

/**
 * Computes a scorecard for a single rolling window from a flat array of rows.
 * Rows are filtered to those recorded within `windowDays` days of `nowMs`.
 */
export function aggregate(
  rows: OutcomeRow[],
  windowDays: Window,
  nowMs: number = Date.now(),
  lastPublisherTxTimestamp: string | null = null
): Scorecard {
  const cutoff = nowMs - windowDays * MS_PER_DAY;
  const windowRows = rows.filter((r) => r.recordedAt >= cutoff);
  const computedAt = new Date(nowMs).toISOString();

  if (windowRows.length < MIN_SAMPLES) {
    return {
      state: 'insufficient_data',
      window: windowDays,
      sampleSize: windowRows.length,
      computedAt,
      lastPublisherTxTimestamp,
    };
  }

  // Robust outlier detection using median and MAD on settlement times
  const settlementValues = windowRows
    .map((r) => r.settleMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const median = settlementValues.length > 0 ? percentile(settlementValues, 50) : null;
  const mad =
    settlementValues.length > 0
      ? percentile(
          settlementValues.map((v) => Math.abs(v - (median as number))).sort((a, b) => a - b),
          50
        )
      : null;
  if (median !== null && mad !== null) {
    for (const r of windowRows) {
      if (r.settleMs !== null && Math.abs(r.settleMs - (median as number)) > 3 * (mad as number)) {
        r.trimmed = true;
      } else {
        r.trimmed = false;
      }
    }
  } else {
    for (const r of windowRows) {
      r.trimmed = false;
    }
  }

  const untrimmed = windowRows.filter((r) => !r.trimmed);
  const fillRate =
    untrimmed.length > 0 ? untrimmed.filter((r) => r.filled).length / untrimmed.length : 0;
  const settleSorted = untrimmed
    .map((r) => r.settleMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const slippageSorted = untrimmed
    .map((r) => r.slippage)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);

  const settleMs: Percentiles =
    settleSorted.length > 0
      ? { p50: percentile(settleSorted, 50), p95: percentile(settleSorted, 95) }
      : { p50: 0, p95: 0 };

  const slippage: Percentiles =
    slippageSorted.length > 0
      ? { p50: percentile(slippageSorted, 50), p95: percentile(slippageSorted, 95) }
      : { p50: 0, p95: 0 };

  return {
    state: 'ok',
    window: windowDays,
    sampleSize: windowRows.length,
    fillRate,
    settleMs,
    slippage,
    computedAt,
    lastPublisherTxTimestamp,
  };
}

/**
 * Computes 7, 30, and 90-day scorecards for an anchor's outcome rows.
 */
export function buildScorecards(
  rows: OutcomeRow[],
  nowMs: number = Date.now(),
  lastPublisherTxTimestamp: string | null = null
): Record<Window, Scorecard> {
  return {
    7: aggregate(rows, 7, nowMs, lastPublisherTxTimestamp),
    30: aggregate(rows, 30, nowMs, lastPublisherTxTimestamp),
    90: aggregate(rows, 90, nowMs, lastPublisherTxTimestamp),
  };
}

// ─── Probe coverage progress tracker (Issue #???) ─────────────────────────────

export interface ProbeCoverageGap {
  /** Start of the gap (inclusive) as ISO date string (YYYY-MM-DD UTC) */
  startDate: string;
  /** End of the gap (inclusive) as ISO date string (YYYY-MM-DD UTC) */
  endDate: string;
  /** Number of days in the gap */
  days: number;
}

export interface AnchorProbeCoverage {
  /** Anchor domain (from probe samples) */
  domain: string;
  /** Days of continuous coverage up to today */
  continuousDays: number;
  /** Any gaps in coverage (ordered chronologically) */
  gaps: ProbeCoverageGap[];
  /** Earliest probe sample date (YYYY-MM-DD UTC) */
  firstProbeDate: string | null;
  /** Latest probe sample date (YYYY-MM-DD UTC) */
  latestProbeDate: string | null;
}

export interface ProbeCoverageReport {
  /** Coverage per anchor domain */
  anchors: AnchorProbeCoverage[];
  /** Minimum continuous days across all anchors */
  minContinuousDays: number;
  /** Maximum continuous days across all anchors */
  maxContinuousDays: number;
  /** Average continuous days across all anchors */
  avgContinuousDays: number;
  /** Days until the 90-day threshold is met (based on the anchor with the least continuous coverage) */
  daysUntilThreshold: number;
  /** Timestamp when the report was generated (ISO string) */
  generatedAt: string;
}

/**
 * Formats a Date as YYYY-MM-DD (UTC)
 */
function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD (UTC) string into a Date
 */
function parseDateUTC(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day));
}

/**
 * Computes probe coverage for a single anchor given its probe samples
 */
export function computeAnchorProbeCoverage(
  samples: ProbeLedgerRow[],
  now: Date = new Date()
): AnchorProbeCoverage {
  // Map of date (YYYY-MM-DD UTC) to whether there was at least one successful probe
  const dailyCoverage = new Map<string, boolean>();

  for (const sample of samples) {
    const sampleDate = formatDateUTC(new Date(sample.probedAt));
    if (!dailyCoverage.has(sampleDate)) {
      dailyCoverage.set(sampleDate, false);
    }
    if (sample.reachable) {
      dailyCoverage.set(sampleDate, true);
    }
  }

  const sortedDates = Array.from(dailyCoverage.keys()).sort();
  const firstProbeDate = sortedDates[0] || null;
  const latestProbeDate = sortedDates[sortedDates.length - 1] || null;

  // Compute gaps
  const gaps: ProbeCoverageGap[] = [];
  let currentGapStart: string | null = null;

  if (firstProbeDate) {
    const start = parseDateUTC(firstProbeDate);
    const end = parseDateUTC(formatDateUTC(now));
    const currentDate = new Date(start);

    while (currentDate <= end) {
      const dateStr = formatDateUTC(currentDate);
      const hasCoverage = dailyCoverage.get(dateStr) === true;

      if (!hasCoverage) {
        if (!currentGapStart) {
          currentGapStart = dateStr;
        }
      } else {
        if (currentGapStart) {
          const gapStart = parseDateUTC(currentGapStart);
          const gapEnd = new Date(currentDate);
          gapEnd.setUTCDate(gapEnd.getUTCDate() - 1);
          const gapDays =
            Math.floor((gapEnd.getTime() - gapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          gaps.push({
            startDate: currentGapStart,
            endDate: formatDateUTC(gapEnd),
            days: gapDays,
          });
          currentGapStart = null;
        }
      }

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    // If there's an ongoing gap at the end
    if (currentGapStart) {
      const gapStart = parseDateUTC(currentGapStart);
      const gapDays =
        Math.floor((end.getTime() - gapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      gaps.push({
        startDate: currentGapStart,
        endDate: formatDateUTC(end),
        days: gapDays,
      });
    }
  }

  // Compute continuous days from today backwards
  let continuousDays = 0;
  const today = formatDateUTC(now);
  let checkDate = new Date(parseDateUTC(today));

  while (true) {
    const dateStr = formatDateUTC(checkDate);
    if (dailyCoverage.get(dateStr) === true) {
      continuousDays++;
    } else {
      break;
    }
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }

  return {
    domain: samples[0]?.domain || '',
    continuousDays,
    gaps,
    firstProbeDate,
    latestProbeDate,
  };
}

/**
 * Computes the overall probe coverage report across all anchors
 */
export function computeProbeCoverageReport(
  allSamples: ProbeLedgerRow[],
  now: Date = new Date()
): ProbeCoverageReport {
  // Group samples by domain
  const samplesByDomain = new Map<string, ProbeLedgerRow[]>();
  for (const sample of allSamples) {
    const existing = samplesByDomain.get(sample.domain) || [];
    existing.push(sample);
    samplesByDomain.set(sample.domain, existing);
  }

  const anchors: AnchorProbeCoverage[] = [];
  for (const [domain, samples] of samplesByDomain) {
    anchors.push(computeAnchorProbeCoverage(samples, now));
  }

  const continuousDaysList = anchors.map((a) => a.continuousDays);
  const minContinuousDays = continuousDaysList.length ? Math.min(...continuousDaysList) : 0;
  const maxContinuousDays = continuousDaysList.length ? Math.max(...continuousDaysList) : 0;
  const avgContinuousDays = continuousDaysList.length
    ? continuousDaysList.reduce((a, b) => a + b, 0) / continuousDaysList.length
    : 0;
  const daysUntilThreshold = Math.max(0, 90 - minContinuousDays);

  return {
    anchors,
    minContinuousDays,
    maxContinuousDays,
    avgContinuousDays,
    daysUntilThreshold,
    generatedAt: now.toISOString(),
  };
}
