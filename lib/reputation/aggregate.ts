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
    (e) => e.anchorId === anchorId && e.corridor === corridor && e.completedAt >= cutoff
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
  const speedScore =
    p50SettlementMs !== null ? Math.max(0, 1 - p50SettlementMs / 3600000) : 0;
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

export function groupByCorridor(
  events: SettlementEvent[]
): Map<string, SettlementEvent[]> {
  const map = new Map<string, SettlementEvent[]>();
  for (const e of events) {
    const key = `${e.anchorId}::${e.corridor}`;
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}