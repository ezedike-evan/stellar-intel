import { tryGetReputationStore } from '@/lib/reputation/store';
import { computeExecutionSla } from './execution-sla';

export interface CorridorSettleSummary {
  p95Ms: number;
  sampleSize: number;
}

export async function fetchCorridorSettleSummaries(
  corridorId: string,
  nowMs: number = Date.now()
): Promise<Map<string, CorridorSettleSummary>> {
  const store = tryGetReputationStore();
  if (!store) return new Map();

  const rows = await store.query({ corridor: corridorId, direction: 'withdraw' });

  const anchorIds = new Set<string>();
  for (const r of rows) {
    anchorIds.add(r.anchorId);
  }

  const summaries = new Map<string, CorridorSettleSummary>();
  for (const anchorId of anchorIds) {
    const sla = computeExecutionSla(rows, { anchorId, corridor: corridorId }, { nowMs });
    if (sla.state === 'ok') {
      summaries.set(anchorId, {
        p95Ms: sla.p95Ms,
        sampleSize: sla.sampleSize,
      });
    }
  }

  return summaries;
}
