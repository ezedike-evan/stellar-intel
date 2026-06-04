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
    (e) => e.anchorId === anchorId && e.corridor === corridor && e.completedAt >= cutoff && !e.disputed
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
  const times = relevant.map((e) => e.settlementMs).sort((a, b) => a - b);
  const avgSettlementMs = Math.round(times.reduce((s, v) => s + v, 0) / times.length);
  const p50SettlementMs = times[Math.floor(times.length * 0.5)] ?? null;
  const p95SettlementMs = times[Math.floor(times.length * 0.95)] ?? null;

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
 * A single outcome row written to the reputation log after a transaction
 * completes. All PII has already been stripped (see redact.ts).
 */
export interface OutcomeRow {
  intentHash: string
  anchorId: string
  /** Whether the transaction reached the "completed" state. */
  filled: boolean
  /** Settlement time in milliseconds (null when not yet settled). */
  settleMs: number | null
  /** Slippage as a decimal fraction, e.g. 0.02 = 2 % (null when unavailable). */
  slippage: number | null
  /** Unix timestamp (ms) when the row was recorded. */
  recordedAt: number
}

/** Rolling window in days — 7, 30, or 90. */
export type Window = 7 | 30 | 90

// ─── Scorecard ────────────────────────────────────────────────────────────────

export interface Percentiles {
  p50: number
  p95: number
}

/**
 * The computed scorecard for one rolling window.
 * When there are fewer than MIN_SAMPLES rows the state is "insufficient_data".
 */
export type Scorecard =
  | {
      state: 'ok'
      window: Window
      sampleSize: number
      fillRate: number
      settleMs: Percentiles
      slippage: Percentiles
    }
  | {
      state: 'insufficient_data'
      window: Window
      sampleSize: number
    }

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum rows required to compute a scorecard. */
export const MIN_SAMPLES = 1

const MS_PER_DAY = 86_400_000

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the p-th percentile (0–100) of a sorted numeric array.
 * Uses linear interpolation (same as NumPy's default).
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0] ?? 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const loVal = sorted[lo] ?? 0
  const hiVal = sorted[hi] ?? 0
  return loVal + (hiVal - loVal) * (idx - lo)
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
): Scorecard {
  const cutoff = nowMs - windowDays * MS_PER_DAY
  const windowRows = rows.filter((r) => r.recordedAt >= cutoff)

  if (windowRows.length < MIN_SAMPLES) {
    return { state: 'insufficient_data', window: windowDays, sampleSize: windowRows.length }
  }

  const fillRate = windowRows.filter((r) => r.filled).length / windowRows.length

  const settleSorted = windowRows
    .map((r) => r.settleMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)

  const slippageSorted = windowRows
    .map((r) => r.slippage)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)

  const settleMs: Percentiles =
    settleSorted.length > 0
      ? { p50: percentile(settleSorted, 50), p95: percentile(settleSorted, 95) }
      : { p50: 0, p95: 0 }

  const slippage: Percentiles =
    slippageSorted.length > 0
      ? { p50: percentile(slippageSorted, 50), p95: percentile(slippageSorted, 95) }
      : { p50: 0, p95: 0 }

  return {
    state: 'ok',
    window: windowDays,
    sampleSize: windowRows.length,
    fillRate,
    settleMs,
    slippage,
  }
}

/**
 * Computes 7, 30, and 90-day scorecards for an anchor's outcome rows.
 */
export function buildScorecards(
  rows: OutcomeRow[],
  nowMs: number = Date.now(),
): Record<Window, Scorecard> {
  return {
    7: aggregate(rows, 7, nowMs),
    30: aggregate(rows, 30, nowMs),
    90: aggregate(rows, 90, nowMs),
  }
}
