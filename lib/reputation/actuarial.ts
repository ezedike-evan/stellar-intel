import type { OutcomeLogRow, OutcomeStatus, ProbeLedgerRow } from '@/types/reputation';

/**
 * lib/reputation/actuarial.ts
 *
 * Settlement-SLA actuarial dataset (issue #813). The SLA product (#814) launches
 * only once enough actuarial observations exist — roughly 10k (ROADMAP.md line
 * 101). Real execution outcomes (#799) are the load-bearing signal; probes
 * (#785/#786) accelerate accumulation.
 *
 * The dataset is a derived view: observations are computed from — and
 * cross-referenced back to (via `ref`) — the outcome and probe logs, and kept
 * separate from those source ledgers. The progress report mirrors the 90-day
 * probe-coverage gate (`buildProbeCoverageReport` in `lib/reputation/aggregate.ts`).
 */

/** Observations required before the settlement-SLA product can launch. */
export const ACTUARIAL_THRESHOLD = 10_000;

/** How an observation resolved: a clean settlement, a failure mode, or a probe. */
export type ObservationResult = 'success' | 'refunded' | 'expired' | 'error' | 'partial' | 'probe';

/** One actuarial observation, cross-referenced to its source log via `ref`. */
export interface ActuarialObservation {
  source: 'settlement' | 'probe';
  corridor: string;
  anchorId: string;
  result: ObservationResult;
  /** Settlement/probe latency in seconds; null when unknown. */
  latencySeconds: number | null;
  /** RFC 3339 timestamp of the observation. */
  at: string;
  /** Cross-reference into the source log: outcome `intentHash`, or probe domain. */
  ref: string;
}

function resultFromOutcome(outcome: OutcomeStatus): ObservationResult {
  return outcome === 'completed' ? 'success' : outcome;
}

/** A terminal settlement outcome becomes one actuarial observation. */
export function observationFromOutcome(row: OutcomeLogRow): ActuarialObservation {
  return {
    source: 'settlement',
    corridor: row.corridor,
    anchorId: row.anchorId,
    result: resultFromOutcome(row.outcome),
    latencySeconds: row.settleSeconds,
    at: row.createdAt,
    ref: row.intentHash,
  };
}

/**
 * A reachable probe sample accelerates accumulation. Unreachable probes carry
 * no actuarial signal and are skipped (returns null). `uptime` probes have no
 * corridor, so they're bucketed under a synthetic `(uptime)` corridor.
 */
export function observationFromProbe(row: ProbeLedgerRow): ActuarialObservation | null {
  if (!row.reachable) return null;
  return {
    source: 'probe',
    corridor: row.corridor ?? '(uptime)',
    anchorId: row.domain,
    result: 'probe',
    latencySeconds: row.latencyMs > 0 ? row.latencyMs / 1000 : null,
    at: row.probedAt,
    ref: row.domain,
  };
}

/** Per-corridor slice of the actuarial dataset. */
export interface CorridorActuarialProgress {
  corridor: string;
  total: number;
  settlements: number;
  probes: number;
  successes: number;
  failures: number;
  /** Median settlement latency (seconds) over this corridor's settlements; null if none. */
  medianLatencySeconds: number | null;
}

/** Progress of the actuarial dataset toward the launch threshold. */
export interface ActuarialProgressReport {
  threshold: number;
  computedAt: string;
  total: number;
  settlements: number;
  probes: number;
  thresholdMet: boolean;
  /** Fraction of the threshold reached, clamped to [0, 1]. */
  progress: number;
  /** Observations still needed to reach the threshold (0 when met). */
  remaining: number;
  corridors: CorridorActuarialProgress[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Aggregates observations into a progress report toward the actuarial
 * threshold, with a per-corridor breakdown. Mirrors the probe-coverage gate.
 */
export function buildActuarialProgressReport(
  observations: readonly ActuarialObservation[],
  options?: { now?: Date; threshold?: number }
): ActuarialProgressReport {
  const threshold = options?.threshold ?? ACTUARIAL_THRESHOLD;
  const now = options?.now ?? new Date();

  const byCorridor = new Map<string, ActuarialObservation[]>();
  for (const obs of observations) {
    const list = byCorridor.get(obs.corridor) ?? [];
    list.push(obs);
    byCorridor.set(obs.corridor, list);
  }

  const corridors: CorridorActuarialProgress[] = [...byCorridor.entries()]
    .map(([corridor, list]) => {
      const settlements = list.filter((o) => o.source === 'settlement');
      const latencies = settlements
        .map((o) => o.latencySeconds)
        .filter((v): v is number => v !== null);
      return {
        corridor,
        total: list.length,
        settlements: settlements.length,
        probes: list.length - settlements.length,
        successes: list.filter((o) => o.result === 'success').length,
        failures: settlements.filter((o) => o.result !== 'success').length,
        medianLatencySeconds: median(latencies),
      };
    })
    .sort((a, b) => b.total - a.total);

  const total = observations.length;
  const settlements = observations.filter((o) => o.source === 'settlement').length;

  return {
    threshold,
    computedAt: now.toISOString(),
    total,
    settlements,
    probes: total - settlements,
    thresholdMet: total >= threshold,
    progress: threshold > 0 ? Math.min(1, total / threshold) : 1,
    remaining: Math.max(0, threshold - total),
    corridors,
  };
}
