/**
 * lib/reputation/execution-sla.ts
 *
 * Execution SLA computation and breach assessment.
 *
 * Settle-time percentiles use nearest-rank over observed settlement latencies
 * without outlier trimming. Nearest-rank quotes actual settlement durations that
 * occurred in production rather than interpolated approximations. Outlier
 * trimming is intentionally excluded: trimming removes the long-tail latency
 * spikes that represent SLA breaches, which defeats the purpose of an SLA
 * measurement system.
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { ANCHORS } from '@/constants/anchors';
import type { OutcomeLogRow } from '@/types/reputation';
import { nearestRankPercentile } from './percentile';
import { getSlaThresholds, type SlaThresholds } from '@/constants/sla-thresholds';

extendZodWithOpenApi(z);

export const SLA_WINDOW_DAYS = 30;
export const SLA_MIN_SAMPLES = 30;
export const SLA_P99_MIN_SAMPLES = 100;
export const SLA_DAILY_MIN_SAMPLES = 5;

const DAY_MS = 86_400_000;

export interface ExecutionSlaScope {
  anchorId: string;
  corridor?: string;
}

export interface ExecutionSlaOptions {
  nowMs?: number;
  windowDays?: number;
}

export type ExecutionSla =
  | {
      state: 'ok';
      anchorId: string;
      corridor: string | null;
      windowDays: number;
      computedAt: string;
      sampleSize: number;
      terminalTxCount: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number | null;
    }
  | {
      state: 'insufficient_data';
      anchorId: string;
      corridor: string | null;
      windowDays: number;
      computedAt: string;
      sampleSize: number;
      terminalTxCount: number;
      p50Ms: null;
      p95Ms: null;
      p99Ms: null;
    };

export const ExecutionSlaSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    anchorId: z.string(),
    corridor: z.string().nullable(),
    windowDays: z.number().int().positive(),
    computedAt: z.string(),
    sampleSize: z.number().int().nonnegative(),
    terminalTxCount: z.number().int().nonnegative(),
    p50Ms: z.number(),
    p95Ms: z.number(),
    p99Ms: z.number().nullable(),
  }),
  z.object({
    state: z.literal('insufficient_data'),
    anchorId: z.string(),
    corridor: z.string().nullable(),
    windowDays: z.number().int().positive(),
    computedAt: z.string(),
    sampleSize: z.number().int().nonnegative(),
    terminalTxCount: z.number().int().nonnegative(),
    p50Ms: z.null(),
    p95Ms: z.null(),
    p99Ms: z.null(),
  }),
]);

export const SlaThresholdsSchema = z.object({
  p95Ms: z.number(),
  p99Ms: z.number(),
});

export type SlaBreachStatus = 'within' | 'breach' | 'unknown';

export interface SlaBreach {
  metric: 'p95' | 'p99';
  observedMs: number;
  thresholdMs: number;
}

export const SlaBreachSchema = z.object({
  metric: z.enum(['p95', 'p99']),
  observedMs: z.number(),
  thresholdMs: z.number(),
});

export interface SlaBreachAssessment {
  status: SlaBreachStatus;
  breaches: SlaBreach[];
}

export const SlaBreachAssessmentSchema = z.object({
  status: z.enum(['within', 'breach', 'unknown']),
  breaches: z.array(SlaBreachSchema),
});

export interface ExecutionSlaEntry {
  sla: ExecutionSla;
  breach: SlaBreachAssessment;
}

export const ExecutionSlaEntrySchema = z.object({
  sla: ExecutionSlaSchema,
  breach: SlaBreachAssessmentSchema,
});

export interface SlaDailyPoint {
  day: string; // YYYY-MM-DD
  p95Ms: number | null;
  sampleSize: number;
}

export const SlaDailyPointSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  p95Ms: z.number().nullable(),
  sampleSize: z.number().int().nonnegative(),
});

export interface ExecutionSlaReport {
  anchorId: string;
  windowDays: number;
  computedAt: string;
  thresholds: SlaThresholds;
  overall: ExecutionSlaEntry;
  corridors: Array<ExecutionSlaEntry & { corridor: string }>;
  history: SlaDailyPoint[];
}

export const ExecutionSlaReportSchema = z.object({
  anchorId: z.string(),
  windowDays: z.number().int().positive(),
  computedAt: z.string(),
  thresholds: SlaThresholdsSchema,
  overall: ExecutionSlaEntrySchema,
  corridors: z.array(ExecutionSlaEntrySchema.extend({ corridor: z.string() })),
  history: z.array(SlaDailyPointSchema),
});

export interface ExecutionSlaReportOptions extends ExecutionSlaOptions {
  thresholds?: SlaThresholds;
  corridor?: string;
}

function isScopeMatch(row: OutcomeLogRow, scope: ExecutionSlaScope): boolean {
  if (row.anchorId !== scope.anchorId) return false;
  if (scope.corridor && row.corridor !== scope.corridor) return false;
  return true;
}

function isValidWithdrawRow(
  row: OutcomeLogRow,
  scope: ExecutionSlaScope,
  windowStartMs: number,
  nowMs: number
): boolean {
  if (!isScopeMatch(row, scope)) return false;
  if (row.direction !== 'withdraw') return false;
  if (row.disputed) return false;
  const t = Date.parse(row.createdAt);
  if (Number.isNaN(t) || t < windowStartMs || t > nowMs) return false;
  return true;
}

export function computeExecutionSla(
  rows: readonly OutcomeLogRow[],
  scope: ExecutionSlaScope,
  options?: ExecutionSlaOptions
): ExecutionSla {
  const nowMs = options?.nowMs ?? Date.now();
  const windowDays = options?.windowDays ?? SLA_WINDOW_DAYS;
  const windowStartMs = nowMs - windowDays * DAY_MS;
  const computedAt = new Date(nowMs).toISOString();
  const corridor = scope.corridor ?? null;

  let terminalTxCount = 0;
  const samples: number[] = [];

  for (const row of rows) {
    if (!isValidWithdrawRow(row, scope, windowStartMs, nowMs)) continue;
    terminalTxCount += 1;

    if (
      row.outcome === 'completed' &&
      typeof row.settleSeconds === 'number' &&
      Number.isFinite(row.settleSeconds) &&
      row.settleSeconds >= 0
    ) {
      samples.push(Math.round(row.settleSeconds * 1000));
    }
  }

  const sampleSize = samples.length;

  if (sampleSize < SLA_MIN_SAMPLES) {
    return {
      state: 'insufficient_data',
      anchorId: scope.anchorId,
      corridor,
      windowDays,
      computedAt,
      sampleSize,
      terminalTxCount,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
    };
  }

  samples.sort((a, b) => a - b);
  const p50Ms = nearestRankPercentile(samples, 50)!;
  const p95Ms = nearestRankPercentile(samples, 95)!;
  const p99Ms = sampleSize >= SLA_P99_MIN_SAMPLES ? nearestRankPercentile(samples, 99) : null;

  return {
    state: 'ok',
    anchorId: scope.anchorId,
    corridor,
    windowDays,
    computedAt,
    sampleSize,
    terminalTxCount,
    p50Ms,
    p95Ms,
    p99Ms,
  };
}

export function computeExecutionSlaByCorridor(
  rows: readonly OutcomeLogRow[],
  anchorId: string,
  options?: ExecutionSlaOptions
): Map<string, ExecutionSla> {
  const nowMs = options?.nowMs ?? Date.now();
  const windowDays = options?.windowDays ?? SLA_WINDOW_DAYS;
  const windowStartMs = nowMs - windowDays * DAY_MS;

  const corridors = new Set<string>();
  for (const row of rows) {
    if (row.anchorId !== anchorId) continue;
    if (row.direction !== 'withdraw') continue;
    if (row.disputed) continue;
    const t = Date.parse(row.createdAt);
    if (Number.isNaN(t) || t < windowStartMs || t > nowMs) continue;
    corridors.add(row.corridor);
  }

  const result = new Map<string, ExecutionSla>();
  for (const corridor of corridors) {
    result.set(corridor, computeExecutionSla(rows, { anchorId, corridor }, options));
  }
  return result;
}

export function evaluateSlaBreach(
  sla: ExecutionSla,
  thresholds: SlaThresholds
): SlaBreachAssessment {
  if (sla.state === 'insufficient_data') {
    return { status: 'unknown', breaches: [] };
  }

  const breaches: SlaBreach[] = [];
  if (sla.p95Ms > thresholds.p95Ms) {
    breaches.push({
      metric: 'p95',
      observedMs: sla.p95Ms,
      thresholdMs: thresholds.p95Ms,
    });
  }

  if (sla.p99Ms !== null && sla.p99Ms > thresholds.p99Ms) {
    breaches.push({
      metric: 'p99',
      observedMs: sla.p99Ms,
      thresholdMs: thresholds.p99Ms,
    });
  }

  return {
    status: breaches.length > 0 ? 'breach' : 'within',
    breaches,
  };
}

export function buildDailyP95Series(
  rows: readonly OutcomeLogRow[],
  scope: ExecutionSlaScope,
  options?: { nowMs?: number; days?: number }
): SlaDailyPoint[] {
  const nowMs = options?.nowMs ?? Date.now();
  const days = options?.days ?? SLA_WINDOW_DAYS;

  const nowDt = new Date(nowMs);
  const endDayUtc = Date.UTC(
    nowDt.getUTCFullYear(),
    nowDt.getUTCMonth(),
    nowDt.getUTCDate()
  );

  const points: SlaDailyPoint[] = [];

  for (let i = 0; i < days; i++) {
    const dayStartMs = endDayUtc - (days - 1 - i) * DAY_MS;
    const dayEndMs = dayStartMs + DAY_MS;
    const day = new Date(dayStartMs).toISOString().slice(0, 10);

    const dailySamples: number[] = [];

    for (const row of rows) {
      if (!isScopeMatch(row, scope)) continue;
      if (row.direction !== 'withdraw') continue;
      if (row.disputed) continue;
      if (row.outcome !== 'completed') continue;
      if (
        typeof row.settleSeconds !== 'number' ||
        !Number.isFinite(row.settleSeconds) ||
        row.settleSeconds < 0
      ) {
        continue;
      }
      const t = Date.parse(row.createdAt);
      if (Number.isNaN(t) || t < dayStartMs || t >= dayEndMs || t > nowMs) continue;

      dailySamples.push(Math.round(row.settleSeconds * 1000));
    }

    const sampleSize = dailySamples.length;
    let p95Ms: number | null = null;
    if (sampleSize >= SLA_DAILY_MIN_SAMPLES) {
      dailySamples.sort((a, b) => a - b);
      p95Ms = nearestRankPercentile(dailySamples, 95);
    }

    points.push({ day, p95Ms, sampleSize });
  }

  return points;
}

export function buildExecutionSlaReport(
  rows: readonly OutcomeLogRow[],
  anchorId: string,
  options?: ExecutionSlaReportOptions
): ExecutionSlaReport {
  const nowMs = options?.nowMs ?? Date.now();
  const windowDays = options?.windowDays ?? SLA_WINDOW_DAYS;
  const thresholds = options?.thresholds ?? getSlaThresholds(anchorId);

  const overallSla = computeExecutionSla(rows, { anchorId }, { nowMs, windowDays });
  const overallBreach = evaluateSlaBreach(overallSla, thresholds);

  const registeredCorridors = ANCHORS.find((a) => a.id === anchorId)?.corridors ?? [];
  const byCorridorMap = computeExecutionSlaByCorridor(rows, anchorId, { nowMs, windowDays });

  let corridorEntries: Array<ExecutionSlaEntry & { corridor: string }>;

  if (options?.corridor) {
    const targetCorridor = options.corridor;
    const sla =
      byCorridorMap.get(targetCorridor) ??
      computeExecutionSla(rows, { anchorId, corridor: targetCorridor }, { nowMs, windowDays });
    corridorEntries = [
      {
        corridor: targetCorridor,
        sla,
        breach: evaluateSlaBreach(sla, thresholds),
      },
    ];
  } else {
    const allCorridors = Array.from(
      new Set([...registeredCorridors, ...byCorridorMap.keys()])
    ).sort();
    corridorEntries = allCorridors.map((corridor) => {
      const sla =
        byCorridorMap.get(corridor) ??
        computeExecutionSla(rows, { anchorId, corridor }, { nowMs, windowDays });
      return {
        corridor,
        sla,
        breach: evaluateSlaBreach(sla, thresholds),
      };
    });
  }

  const history = buildDailyP95Series(
    rows,
    options?.corridor ? { anchorId, corridor: options.corridor } : { anchorId },
    { nowMs, days: windowDays }
  );

  return {
    anchorId,
    windowDays: overallSla.windowDays,
    computedAt: overallSla.computedAt,
    thresholds,
    overall: {
      sla: overallSla,
      breach: overallBreach,
    },
    corridors: corridorEntries,
    history,
  };
}
