/**
 * lib/reputation/execution-sla.ts
 *
 * Pure per-anchor / per-corridor settle-latency SLAs over a trailing window
 * (SLA002). Reads only `OutcomeLogRow` values passed in — no store, logger or
 * network.
 *
 * Two deliberate departures from `aggregate()` in ./aggregate.ts:
 *
 *   - Nearest-rank percentiles, not linear interpolation. An SLA quotes a
 *     settlement time that actually happened; interpolating between two
 *     neighbouring samples invents a duration no transaction ever took.
 *
 *   - No outlier trimming. The median/MAD filter in `aggregate()` drops the
 *     slow tail, which is exactly the tail an SLA exists to report. A breach
 *     must show up in p95/p99, so every completed settlement counts.
 */

import { z } from 'zod';
import type { OutcomeLogRow } from '@/types/reputation';
import { nearestRankPercentile } from './percentile';

/** Trailing window an SLA is computed over. */
export const SLA_WINDOW_DAYS = 30;

/** Below this many completed settlements the state is insufficient_data. */
export const SLA_MIN_SAMPLES = 30;

/** p99 is reported only from this many samples (below it, nearest-rank p99 is just the maximum). */
export const SLA_P99_MIN_SAMPLES = 100;

const MS_PER_DAY = 86_400_000;

interface ExecutionSlaBase {
  windowDays: number;
  /** ISO timestamp of the window's start: nowMs − windowDays days. */
  windowStart: string;
  /** ISO timestamp of the window's end: nowMs. */
  windowEnd: string;
  /** Completed settlements with a timing — the percentile input. */
  sampleSize: number;
  /** All in-window rows for the scope, whatever their outcome. */
  terminalCount: number;
  minSamples: number;
  /** ISO timestamp, equal to windowEnd. */
  computedAt: string;
}

export type ExecutionSla =
  | (ExecutionSlaBase & { state: 'ok'; p50Ms: number; p95Ms: number; p99Ms: number | null })
  | (ExecutionSlaBase & { state: 'insufficient_data' });

export interface ExecutionSlaScope {
  anchorId: string;
  corridor?: string;
}

export interface ExecutionSlaOptions {
  nowMs?: number;
  windowDays?: number;
  minSamples?: number;
}

function windowBounds(options: ExecutionSlaOptions | undefined): {
  nowMs: number;
  windowDays: number;
  windowStartMs: number;
  windowEndMs: number;
} {
  const nowMs = options?.nowMs ?? Date.now();
  const windowDays = options?.windowDays ?? SLA_WINDOW_DAYS;
  return {
    nowMs,
    windowDays,
    windowStartMs: nowMs - windowDays * MS_PER_DAY,
    windowEndMs: nowMs,
  };
}

function inWindow(createdAt: string, windowStartMs: number, windowEndMs: number): boolean {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && windowStartMs <= t && t <= windowEndMs;
}

/**
 * Collects the scope's settle-latency samples in milliseconds, sorted
 * ascending, plus the count of every in-scope row regardless of outcome.
 */
export function settleSamplesMs(
  rows: readonly OutcomeLogRow[],
  scope: ExecutionSlaScope,
  windowStartMs: number,
  windowEndMs: number
): { samplesMs: number[]; terminalCount: number } {
  const samplesMs: number[] = [];
  let terminalCount = 0;

  for (const row of rows) {
    if (row.anchorId !== scope.anchorId) continue;
    if (scope.corridor !== undefined && row.corridor !== scope.corridor) continue;
    if (row.direction !== 'withdraw') continue;
    if (row.disputed !== false) continue;
    if (!inWindow(row.createdAt, windowStartMs, windowEndMs)) continue;

    terminalCount++;

    if (row.outcome !== 'completed') continue;
    if (row.settleSeconds === null || !Number.isFinite(row.settleSeconds)) continue;
    if (row.settleSeconds < 0) continue;

    samplesMs.push(Math.round(row.settleSeconds * 1000));
  }

  samplesMs.sort((a, b) => a - b);
  return { samplesMs, terminalCount };
}

/** Computes the trailing-window execution SLA for one anchor, optionally one corridor. */
export function computeExecutionSla(
  rows: readonly OutcomeLogRow[],
  scope: ExecutionSlaScope,
  options?: ExecutionSlaOptions
): ExecutionSla {
  const { nowMs, windowDays, windowStartMs, windowEndMs } = windowBounds(options);
  const minSamples = options?.minSamples ?? SLA_MIN_SAMPLES;
  const { samplesMs, terminalCount } = settleSamplesMs(rows, scope, windowStartMs, windowEndMs);

  const base: ExecutionSlaBase = {
    windowDays,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    sampleSize: samplesMs.length,
    terminalCount,
    minSamples,
    computedAt: new Date(nowMs).toISOString(),
  };

  // The empty check keeps `minSamples: 0` from producing an `ok` state whose
  // percentiles have no sample to read.
  if (samplesMs.length === 0 || samplesMs.length < minSamples) {
    return { ...base, state: 'insufficient_data' };
  }

  return {
    ...base,
    state: 'ok',
    p50Ms: nearestRankPercentile(samplesMs, 50)!,
    p95Ms: nearestRankPercentile(samplesMs, 95)!,
    p99Ms: samplesMs.length < SLA_P99_MIN_SAMPLES ? null : nearestRankPercentile(samplesMs, 99)!,
  };
}

/** Computes the execution SLA for every corridor the anchor had withdraw rows on in-window. */
export function computeExecutionSlaByCorridor(
  rows: readonly OutcomeLogRow[],
  anchorId: string,
  options?: ExecutionSlaOptions
): Array<{ corridor: string; sla: ExecutionSla }> {
  const { nowMs, windowStartMs, windowEndMs } = windowBounds(options);
  const corridors = new Set<string>();

  for (const row of rows) {
    if (row.anchorId !== anchorId) continue;
    if (row.direction !== 'withdraw') continue;
    if (row.disputed !== false) continue;
    if (!inWindow(row.createdAt, windowStartMs, windowEndMs)) continue;
    corridors.add(row.corridor);
  }

  const sharedOptions: ExecutionSlaOptions = { ...options, nowMs };

  return [...corridors].sort().map((corridor) => ({
    corridor,
    sla: computeExecutionSla(rows, { anchorId, corridor }, sharedOptions),
  }));
}

const executionSlaBaseSchema = z.object({
  windowDays: z.number(),
  windowStart: z.string(),
  windowEnd: z.string(),
  sampleSize: z.number().int().nonnegative(),
  terminalCount: z.number().int().nonnegative(),
  minSamples: z.number().int().nonnegative(),
  computedAt: z.string(),
});

export const ExecutionSlaSchema = z.discriminatedUnion('state', [
  executionSlaBaseSchema.extend({
    state: z.literal('ok'),
    p50Ms: z.number(),
    p95Ms: z.number(),
    p99Ms: z.number().nullable(),
  }),
  executionSlaBaseSchema.extend({ state: z.literal('insufficient_data') }),
]);
