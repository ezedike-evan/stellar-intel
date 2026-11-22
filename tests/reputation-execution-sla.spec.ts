import { describe, it, expect } from 'vitest';
import { nearestRankPercentile } from '@/lib/reputation/percentile';
import {
  computeExecutionSla,
  computeExecutionSlaByCorridor,
  evaluateSlaBreach,
  buildDailyP95Series,
  buildExecutionSlaReport,
  ExecutionSlaReportSchema,
  type ExecutionSla,
} from '@/lib/reputation/execution-sla';
import { makeOutcomeRow } from './fixtures/outcome-rows';

const NOW = Date.parse('2026-06-04T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('nearestRankPercentile', () => {
  it('returns null for an empty array', () => {
    expect(nearestRankPercentile([], 50)).toBeNull();
  });

  it('returns the element for a single-element array', () => {
    expect(nearestRankPercentile([42], 50)).toBe(42);
    expect(nearestRankPercentile([42], 95)).toBe(42);
  });

  it('computes expected nearest-rank percentiles on ordered values', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(nearestRankPercentile(vals, 50)).toBe(50);
    expect(nearestRankPercentile(vals, 95)).toBe(95);
    expect(nearestRankPercentile(vals, 99)).toBe(99);
  });
});

describe('evaluateSlaBreach', () => {
  const thresholds = { p95Ms: 15 * 60 * 1000, p99Ms: 60 * 60 * 1000 };

  it('evaluates unknown for insufficient_data', () => {
    const sla: ExecutionSla = {
      state: 'insufficient_data',
      anchorId: 'moneygram',
      corridor: null,
      windowDays: 30,
      computedAt: new Date(NOW).toISOString(),
      sampleSize: 10,
      terminalTxCount: 10,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
    };
    const assessment = evaluateSlaBreach(sla, thresholds);
    expect(assessment.status).toBe('unknown');
    expect(assessment.breaches).toHaveLength(0);
  });

  it('evaluates within when both percentiles are below or equal to thresholds', () => {
    const sla: ExecutionSla = {
      state: 'ok',
      anchorId: 'moneygram',
      corridor: null,
      windowDays: 30,
      computedAt: new Date(NOW).toISOString(),
      sampleSize: 100,
      terminalTxCount: 100,
      p50Ms: 60_000,
      p95Ms: thresholds.p95Ms, // equal is within
      p99Ms: thresholds.p99Ms, // equal is within
    };
    const assessment = evaluateSlaBreach(sla, thresholds);
    expect(assessment.status).toBe('within');
    expect(assessment.breaches).toHaveLength(0);
  });

  it('evaluates breach when p95 exceeds threshold', () => {
    const sla: ExecutionSla = {
      state: 'ok',
      anchorId: 'moneygram',
      corridor: null,
      windowDays: 30,
      computedAt: new Date(NOW).toISOString(),
      sampleSize: 100,
      terminalTxCount: 100,
      p50Ms: 60_000,
      p95Ms: thresholds.p95Ms + 1000,
      p99Ms: thresholds.p99Ms - 1000,
    };
    const assessment = evaluateSlaBreach(sla, thresholds);
    expect(assessment.status).toBe('breach');
    expect(assessment.breaches).toEqual([
      {
        metric: 'p95',
        observedMs: thresholds.p95Ms + 1000,
        thresholdMs: thresholds.p95Ms,
      },
    ]);
  });

  it('evaluates breach when p99 exceeds threshold', () => {
    const sla: ExecutionSla = {
      state: 'ok',
      anchorId: 'moneygram',
      corridor: null,
      windowDays: 30,
      computedAt: new Date(NOW).toISOString(),
      sampleSize: 100,
      terminalTxCount: 100,
      p50Ms: 60_000,
      p95Ms: thresholds.p95Ms - 1000,
      p99Ms: thresholds.p99Ms + 5000,
    };
    const assessment = evaluateSlaBreach(sla, thresholds);
    expect(assessment.status).toBe('breach');
    expect(assessment.breaches).toEqual([
      {
        metric: 'p99',
        observedMs: thresholds.p99Ms + 5000,
        thresholdMs: thresholds.p99Ms,
      },
    ]);
  });

  it('p99Ms: null never yields a p99 breach', () => {
    const sla: ExecutionSla = {
      state: 'ok',
      anchorId: 'moneygram',
      corridor: null,
      windowDays: 30,
      computedAt: new Date(NOW).toISOString(),
      sampleSize: 40,
      terminalTxCount: 40,
      p50Ms: 60_000,
      p95Ms: thresholds.p95Ms - 1000,
      p99Ms: null,
    };
    const assessment = evaluateSlaBreach(sla, thresholds);
    expect(assessment.status).toBe('within');
    expect(assessment.breaches).toHaveLength(0);
  });
});

describe('buildExecutionSlaReport', () => {
  it('builds a report with 30 rows on usdc-ngn for moneygram', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeOutcomeRow({
        intentHash: `hash-${i}`.padStart(64, '0'),
        anchorId: 'moneygram',
        corridor: 'usdc-ngn',
        settleSeconds: 60 + i,
        createdAt: hoursAgo(10),
      })
    );

    const report = buildExecutionSlaReport(rows, 'moneygram', { nowMs: NOW });

    expect(report.anchorId).toBe('moneygram');
    expect(report.windowDays).toBe(30);
    expect(report.overall.sla.state).toBe('ok');
    expect(report.overall.sla.sampleSize).toBe(30);

    // Moneygram serves 5 registered corridors
    expect(report.corridors.length).toBe(5);
    const ngnEntry = report.corridors.find((c) => c.corridor === 'usdc-ngn');
    expect(ngnEntry?.sla.state).toBe('ok');

    const otherEntries = report.corridors.filter((c) => c.corridor !== 'usdc-ngn');
    for (const entry of otherEntries) {
      expect(entry.sla.state).toBe('insufficient_data');
    }

    // Schema validation
    expect(() => ExecutionSlaReportSchema.parse(report)).not.toThrow();
  });

  it('restricts corridors to a single requested corridor when option is set', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeOutcomeRow({
        intentHash: `hash-${i}`.padStart(64, '0'),
        anchorId: 'moneygram',
        corridor: 'usdc-ngn',
        settleSeconds: 60 + i,
        createdAt: hoursAgo(10),
      })
    );

    const report = buildExecutionSlaReport(rows, 'moneygram', {
      nowMs: NOW,
      corridor: 'usdc-ngn',
    });

    expect(report.corridors).toHaveLength(1);
    expect(report.corridors[0]?.corridor).toBe('usdc-ngn');
    expect(report.corridors[0]?.sla.state).toBe('ok');
  });

  it('builds history with exactly 30 daily points', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeOutcomeRow({
        intentHash: `hash-${i}`.padStart(64, '0'),
        anchorId: 'moneygram',
        corridor: 'usdc-ngn',
        settleSeconds: 60,
        createdAt: hoursAgo(2),
      })
    );

    const history = buildDailyP95Series(rows, { anchorId: 'moneygram' }, { nowMs: NOW, days: 30 });
    expect(history).toHaveLength(30);
    // Last point should have sampleSize: 10 and non-null p95Ms since sampleSize >= 5
    const lastPoint = history[history.length - 1]!;
    expect(lastPoint.sampleSize).toBe(10);
    expect(lastPoint.p95Ms).toBe(60_000);
  });
});
