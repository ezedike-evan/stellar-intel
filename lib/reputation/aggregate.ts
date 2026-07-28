import type { OutcomeLogRow } from '@/types/reputation';

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

// ─── 90-day probe-accumulation progress (#OPS) ────────────────────────────────
// Tracks consecutive daily uptime-probe coverage per anchor toward the mainnet-
// readiness threshold (90 continuous calendar days with no gaps).

/** Mainnet-readiness threshold — aligned with `PROBE_RETENTION_DAYS` in store.ts. */
export const PROBE_MAINNET_READINESS_DAYS = 90;

export interface ProbeCoverageSample {
  probedAt: string;
  kind: 'uptime' | 'quote';
}

export interface CoverageGap {
  /** First missing UTC calendar day (YYYY-MM-DD), inclusive. */
  start: string;
  /** Last missing UTC calendar day (YYYY-MM-DD), inclusive. */
  end: string;
  /** Number of consecutive missing days in this gap. */
  days: number;
}

export interface AnchorProbeCoverage {
  anchorId: string;
  domain: string;
  /** Length of the current consecutive-day streak ending at `streakEnd`. */
  continuousDays: number;
  streakStart: string | null;
  streakEnd: string | null;
  /** Calendar days with ≥1 uptime probe between first observation and `asOfDay`. */
  coveredDays: number;
  daysUntilThreshold: number;
  thresholdMet: boolean;
  hasCoverageGaps: boolean;
  gaps: CoverageGap[];
  firstProbeDay: string | null;
  lastProbeDay: string | null;
}

export interface ProbeCoverageReport {
  thresholdDays: number;
  /** UTC calendar day the report was evaluated through (YYYY-MM-DD). */
  asOfDay: string;
  computedAt: string;
  fleetThresholdMet: boolean;
  /** Days until the slowest anchor reaches the threshold (0 when all have met it). */
  daysUntilFleetThreshold: number;
  anchors: AnchorProbeCoverage[];
}

export interface AnchorProbeDomain {
  anchorId: string;
  domain: string;
}

/** Maps fleet anchors to the domain used for uptime probes. */
export function anchorProbeDomains(
  anchors: ReadonlyArray<{ id: string; homeDomain: string; serviceDomain?: string }>
): AnchorProbeDomain[] {
  return anchors.map((a) => ({
    anchorId: a.id,
    domain: a.serviceDomain ?? a.homeDomain,
  }));
}

function utcDayKey(from: Date | string): string {
  const d = typeof from === 'string' ? new Date(from) : from;
  return d.toISOString().slice(0, 10);
}

function addUtcDays(dayKey: string, delta: number): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function inclusiveDaySpan(start: string, end: string): number {
  if (end < start) return 0;
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  return Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
}

function uptimeCoveredDays(samples: readonly ProbeCoverageSample[]): Set<string> {
  const days = new Set<string>();
  for (const s of samples) {
    if (s.kind !== 'uptime') continue;
    days.add(utcDayKey(s.probedAt));
  }
  return days;
}

function findCoverageGaps(
  covered: ReadonlySet<string>,
  startDay: string,
  endDay: string
): CoverageGap[] {
  if (endDay < startDay) return [];
  const gaps: CoverageGap[] = [];
  let gapStart: string | null = null;

  for (let day = startDay; day <= endDay; day = addUtcDays(day, 1)) {
    if (!covered.has(day)) {
      if (gapStart === null) gapStart = day;
    } else if (gapStart !== null) {
      const gapEnd = addUtcDays(day, -1);
      gaps.push({
        start: gapStart,
        end: gapEnd,
        days: inclusiveDaySpan(gapStart, gapEnd),
      });
      gapStart = null;
    }
  }

  if (gapStart !== null) {
    gaps.push({
      start: gapStart,
      end: endDay,
      days: inclusiveDaySpan(gapStart, endDay),
    });
  }

  return gaps;
}

function continuousStreakEndingAt(
  covered: ReadonlySet<string>,
  endDay: string
): { days: number; start: string; end: string } | null {
  if (!covered.has(endDay)) return null;
  let days = 0;
  let day = endDay;
  while (covered.has(day)) {
    days++;
    day = addUtcDays(day, -1);
  }
  const streakStart = addUtcDays(endDay, -(days - 1));
  return { days, start: streakStart, end: endDay };
}

/**
 * Computes per-anchor probe coverage and fleet-wide progress toward the 90-day
 * mainnet-readiness threshold from uptime probe samples keyed by probe domain.
 */
export function buildProbeCoverageReport(
  samplesByDomain: ReadonlyMap<string, readonly ProbeCoverageSample[]>,
  anchors: readonly AnchorProbeDomain[],
  options?: { now?: Date; thresholdDays?: number }
): ProbeCoverageReport {
  const now = options?.now ?? new Date();
  const thresholdDays = options?.thresholdDays ?? PROBE_MAINNET_READINESS_DAYS;
  const asOfDay = utcDayKey(now);

  const anchorRows: AnchorProbeCoverage[] = anchors.map(({ anchorId, domain }) => {
    const samples = samplesByDomain.get(domain) ?? [];
    const covered = uptimeCoveredDays(samples);

    if (covered.size === 0) {
      return {
        anchorId,
        domain,
        continuousDays: 0,
        streakStart: null,
        streakEnd: null,
        coveredDays: 0,
        daysUntilThreshold: thresholdDays,
        thresholdMet: false,
        hasCoverageGaps: false,
        gaps: [],
        firstProbeDay: null,
        lastProbeDay: null,
      };
    }

    const sortedDays = [...covered].sort();
    const firstProbeDay = sortedDays[0]!;
    const lastProbeDay = sortedDays[sortedDays.length - 1]!;
    const evaluationEnd = asOfDay > lastProbeDay ? asOfDay : lastProbeDay;
    const gaps = findCoverageGaps(covered, firstProbeDay, evaluationEnd);
    const streak =
      continuousStreakEndingAt(covered, asOfDay) ?? continuousStreakEndingAt(covered, lastProbeDay);
    const continuousDays = streak?.days ?? 0;
    const thresholdMet = continuousDays >= thresholdDays && gaps.length === 0;

    return {
      anchorId,
      domain,
      continuousDays,
      streakStart: streak?.start ?? null,
      streakEnd: streak?.end ?? null,
      coveredDays: covered.size,
      daysUntilThreshold: thresholdMet ? 0 : Math.max(0, thresholdDays - continuousDays),
      thresholdMet,
      hasCoverageGaps: gaps.length > 0,
      gaps,
      firstProbeDay,
      lastProbeDay,
    };
  });

  const daysUntilFleetThreshold = anchorRows.reduce(
    (max, row) => Math.max(max, row.daysUntilThreshold),
    0
  );
  const fleetThresholdMet = anchorRows.every((row) => row.thresholdMet);

  return {
    thresholdDays,
    asOfDay,
    computedAt: now.toISOString(),
    fleetThresholdMet,
    daysUntilFleetThreshold,
    anchors: anchorRows,
  };
}

/** Human-readable CLI report for internal ops use. */
export function formatProbeCoverageReport(report: ProbeCoverageReport): string {
  const lines: string[] = [
    `Probe coverage progress (as of ${report.asOfDay} UTC)`,
    `Mainnet-readiness threshold: ${report.thresholdDays} continuous days`,
    `Fleet days until threshold: ${report.daysUntilFleetThreshold}${
      report.fleetThresholdMet ? ' — threshold met' : ''
    }`,
    '',
  ];

  for (const a of report.anchors) {
    lines.push(`${a.anchorId} (${a.domain})`);
    lines.push(
      `  continuous days: ${a.continuousDays} | covered calendar days: ${a.coveredDays} | until threshold: ${a.daysUntilThreshold}`
    );
    if (a.streakStart && a.streakEnd) {
      lines.push(`  current streak: ${a.streakStart} → ${a.streakEnd}`);
    }
    if (a.hasCoverageGaps) {
      lines.push(`  coverage gaps: ${a.gaps.length}`);
      for (const gap of a.gaps) {
        lines.push(`    - ${gap.start} → ${gap.end} (${gap.days} day${gap.days === 1 ? '' : 's'})`);
      }
    } else if (a.firstProbeDay) {
      lines.push('  coverage gaps: none');
    } else {
      lines.push('  coverage gaps: n/a (no probes yet)');
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
