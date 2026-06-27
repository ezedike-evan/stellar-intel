import type { SettlementEvent } from './aggregate';

export interface ScoreResult {
  total: number;
  success_rate: number;
  last_settle_seconds: number;
}

export function getScore(anchorId: string, events: SettlementEvent[]): ScoreResult {
  const relevant = events.filter((e) => e.anchorId === anchorId);

  if (relevant.length === 0) {
    return { total: 0, success_rate: 0, last_settle_seconds: 0 };
  }

  const total = relevant.length;
  const successCount = relevant.filter((e) => e.success).length;
  const success_rate = successCount / total;

  const latest = relevant.reduce((a, b) =>
    a.completedAt.getTime() > b.completedAt.getTime() ? a : b
  );
  const last_settle_seconds = latest.settlementMs / 1000;

  return { total, success_rate, last_settle_seconds };
}
