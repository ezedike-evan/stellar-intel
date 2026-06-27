import { z } from 'zod';
import { percentile, type OutcomeRow } from './aggregate';

// ─── Window config ────────────────────────────────────────────────────────────

export const WINDOW_VALUES = ['7d', '30d', '90d'] as const;
export type HistoryWindow = (typeof WINDOW_VALUES)[number];

const BUCKET_HOURS: Record<HistoryWindow, number> = {
  '7d': 6,
  '30d': 24,
  '90d': 168, // 7 * 24
};

const WINDOW_DAYS: Record<HistoryWindow, number> = { '7d': 7, '30d': 30, '90d': 90 };

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const BucketSchema = z.object({
  timestamp: z.string(), // ISO-8601 bucket start
  fillRate: z.number(),
  avgScore: z.number(),
  settlementLatencyMs: z.number().nullable(),
  sampleCount: z.number().int(),
});

export const HistoryResponseSchema = z.object({
  anchorId: z.string(),
  window: z.enum(WINDOW_VALUES),
  buckets: z.array(BucketSchema),
});

export type Bucket = z.infer<typeof BucketSchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

// ─── Bucket alignment ─────────────────────────────────────────────────────────

function alignToBucket(tsMs: number, bucketHours: number): number {
  const bucketMs = bucketHours * 3_600_000;
  return Math.floor(tsMs / bucketMs) * bucketMs;
}

// ─── Core function ────────────────────────────────────────────────────────────

export function getHistoryBuckets(
  anchorId: string,
  window: HistoryWindow,
  rows: OutcomeRow[],
  nowMs: number = Date.now()
): HistoryResponse {
  const bucketHours = BUCKET_HOURS[window];
  const bucketMs = bucketHours * 3_600_000;
  const cutoff = nowMs - WINDOW_DAYS[window] * 86_400_000;

  // Group rows into aligned buckets
  const bucketMap = new Map<number, OutcomeRow[]>();
  for (const row of rows) {
    if (row.anchorId !== anchorId || row.recordedAt < cutoff) continue;
    const key = alignToBucket(row.recordedAt, bucketHours);
    const list = bucketMap.get(key) ?? [];
    list.push(row);
    bucketMap.set(key, list);
  }

  // Emit all bucket slots for the window, even empty ones
  const startMs = alignToBucket(cutoff, bucketHours);
  const buckets: Bucket[] = [];

  for (let ts = startMs; ts < nowMs; ts += bucketMs) {
    const group = bucketMap.get(ts) ?? [];
    const sampleCount = group.length;

    if (sampleCount === 0) {
      buckets.push({
        timestamp: new Date(ts).toISOString(),
        fillRate: 0,
        avgScore: 0,
        settlementLatencyMs: null,
        sampleCount: 0,
      });
      continue;
    }

    const fillRate = group.filter((r) => r.filled).length / sampleCount;
    const settleTimes = group
      .map((r) => r.settleMs)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const settlementLatencyMs = settleTimes.length > 0 ? percentile(settleTimes, 50) : null;
    const slippages = group
      .map((r) => r.slippage)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const slippage = slippages.length > 0 ? percentile(slippages, 50) : 0;
    const speedScore =
      settlementLatencyMs !== null ? Math.max(0, 1 - settlementLatencyMs / 3_600_000) : 0;
    const avgScore = Math.round((fillRate * 0.7 + speedScore * 0.3 * (1 - slippage)) * 100) / 100;

    buckets.push({
      timestamp: new Date(ts).toISOString(),
      fillRate,
      avgScore,
      settlementLatencyMs,
      sampleCount,
    });
  }

  return { anchorId, window, buckets };
}
