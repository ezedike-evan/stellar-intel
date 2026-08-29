import { describe, it, expect } from 'vitest';
import {
  ACTUARIAL_THRESHOLD,
  observationFromOutcome,
  observationFromProbe,
  buildActuarialProgressReport,
  type ActuarialObservation,
} from '@/lib/reputation/actuarial';
import type { OutcomeLogRow, ProbeLedgerRow } from '@/types/reputation';

function outcome(overrides: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    quotedRate: '1500',
    deliveredRate: '1500',
    quotedAmount: '100',
    deliveredAmount: '150000',
    settleSeconds: 42,
    outcome: 'completed',
    createdAt: '2026-07-01T00:00:00.000Z',
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    ...overrides,
  };
}

function probe(overrides: Partial<ProbeLedgerRow> = {}): ProbeLedgerRow {
  return {
    domain: 'cowrie.exchange',
    kind: 'quote',
    corridor: 'usdc-ngn',
    reachable: true,
    latencyMs: 800,
    failureType: null,
    error: null,
    probedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('observationFromOutcome (#813)', () => {
  it('maps a completed settlement to a success observation, cross-referenced by intentHash', () => {
    const obs = observationFromOutcome(outcome({ intentHash: 'b'.repeat(64), settleSeconds: 90 }));
    expect(obs).toMatchObject({
      source: 'settlement',
      corridor: 'usdc-ngn',
      anchorId: 'cowrie',
      result: 'success',
      latencySeconds: 90,
      ref: 'b'.repeat(64),
    });
  });

  it('carries the failure mode for a non-completed outcome', () => {
    expect(observationFromOutcome(outcome({ outcome: 'error', settleSeconds: null })).result).toBe(
      'error'
    );
    expect(observationFromOutcome(outcome({ outcome: 'refunded' })).result).toBe('refunded');
  });
});

describe('observationFromProbe (#813)', () => {
  it('maps a reachable probe to an observation (latency in seconds, domain ref)', () => {
    const obs = observationFromProbe(probe({ latencyMs: 1500 }));
    expect(obs).toMatchObject({
      source: 'probe',
      corridor: 'usdc-ngn',
      result: 'probe',
      latencySeconds: 1.5,
      ref: 'cowrie.exchange',
    });
  });

  it('buckets an uptime probe (no corridor) under (uptime)', () => {
    expect(observationFromProbe(probe({ kind: 'uptime', corridor: null }))?.corridor).toBe(
      '(uptime)'
    );
  });

  it('skips an unreachable probe (no actuarial signal)', () => {
    expect(observationFromProbe(probe({ reachable: false, latencyMs: 0 }))).toBeNull();
  });
});

describe('buildActuarialProgressReport (#813)', () => {
  it('reports progress toward the threshold and stays below it', () => {
    const observations: ActuarialObservation[] = [
      observationFromOutcome(outcome()),
      observationFromOutcome(outcome({ outcome: 'error', settleSeconds: null })),
      observationFromProbe(probe())!,
    ];

    const report = buildActuarialProgressReport(observations);
    expect(report.threshold).toBe(ACTUARIAL_THRESHOLD);
    expect(report.total).toBe(3);
    expect(report.settlements).toBe(2);
    expect(report.probes).toBe(1);
    expect(report.thresholdMet).toBe(false);
    expect(report.remaining).toBe(ACTUARIAL_THRESHOLD - 3);
    expect(report.progress).toBeCloseTo(3 / ACTUARIAL_THRESHOLD);
  });

  it('breaks progress down per corridor with success/failure and median latency', () => {
    const observations: ActuarialObservation[] = [
      observationFromOutcome(outcome({ settleSeconds: 10 })),
      observationFromOutcome(outcome({ settleSeconds: 30 })),
      observationFromOutcome(outcome({ outcome: 'refunded', settleSeconds: 50 })),
      observationFromOutcome(outcome({ corridor: 'usdc-kes', settleSeconds: 20 })),
    ];

    const report = buildActuarialProgressReport(observations);
    const ngn = report.corridors.find((c) => c.corridor === 'usdc-ngn');
    expect(ngn).toMatchObject({ total: 3, settlements: 3, successes: 2, failures: 1 });
    // latencies 10, 30, 50 → median 30
    expect(ngn?.medianLatencySeconds).toBe(30);
    // corridors sorted by total desc
    expect(report.corridors[0]?.corridor).toBe('usdc-ngn');
  });

  it('marks the threshold met once enough observations accumulate', () => {
    const observations: ActuarialObservation[] = Array.from({ length: 5 }, () =>
      observationFromOutcome(outcome())
    );
    const report = buildActuarialProgressReport(observations, { threshold: 5 });
    expect(report.thresholdMet).toBe(true);
    expect(report.progress).toBe(1);
    expect(report.remaining).toBe(0);
  });
});
