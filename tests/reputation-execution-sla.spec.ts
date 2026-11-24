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

  it('covers daily p95 series requirements (#2145)', () => {
    const testNow = Date.parse('2026-11-01T12:00:00.000Z');

    // 1. returns 30 points; first day is '2026-10-03', last is '2026-11-01'
    const series30 = buildDailyP95Series([], { anchorId: 'moneygram' }, { nowMs: testNow });
    expect(series30).toHaveLength(30);
    expect(series30[0]?.day).toBe('2026-10-03');
    expect(series30[29]?.day).toBe('2026-11-01');

    // 2. a day with 4 samples -> p95Ms: null, sampleSize: 4
    const fourSamples = Array.from({ length: 4 }, (_, i) =>
      makeOutcomeRow({
        intentHash: `f-${i}`.padStart(64, '0'),
        anchorId: 'moneygram',
        settleSeconds: 10 + i,
        createdAt: '2026-11-01T08:00:00.000Z',
      })
    );
    const series4 = buildDailyP95Series(fourSamples, { anchorId: 'moneygram' }, { nowMs: testNow });
    const lastDay4 = series4.find((p) => p.day === '2026-11-01')!;
    expect(lastDay4.sampleSize).toBe(4);
    expect(lastDay4.p95Ms).toBeNull();

    // 3. a day with 20 samples 1..20 s -> p95Ms: 19000
    const twentySamples = Array.from({ length: 20 }, (_, i) =>
      makeOutcomeRow({
        intentHash: `t-${i}`.padStart(64, '0'),
        anchorId: 'moneygram',
        settleSeconds: i + 1, // 1..20 s
        createdAt: '2026-11-01T08:00:00.000Z',
      })
    );
    const series20 = buildDailyP95Series(
      twentySamples,
      { anchorId: 'moneygram' },
      { nowMs: testNow }
    );
    const lastDay20 = series20.find((p) => p.day === '2026-11-01')!;
    expect(lastDay20.sampleSize).toBe(20);
    expect(lastDay20.p95Ms).toBe(19_000);

    // 4. rows at 23:59:59.999Z and 00:00:00.000Z land on different days
    const rowDay1 = makeOutcomeRow({
      intentHash: 'row-d1'.padStart(64, '0'),
      anchorId: 'moneygram',
      settleSeconds: 10,
      createdAt: '2026-10-31T23:59:59.999Z',
    });
    const rowDay2 = makeOutcomeRow({
      intentHash: 'row-d2'.padStart(64, '0'),
      anchorId: 'moneygram',
      settleSeconds: 15,
      createdAt: '2026-11-01T00:00:00.000Z',
    });
    const boundarySeries = buildDailyP95Series(
      [rowDay1, rowDay2],
      { anchorId: 'moneygram' },
      { nowMs: testNow }
    );
    const oct31 = boundarySeries.find((p) => p.day === '2026-10-31')!;
    const nov01 = boundarySeries.find((p) => p.day === '2026-11-01')!;
    expect(oct31.sampleSize).toBe(1);
    expect(nov01.sampleSize).toBe(1);

    // 5. a row after NOW is excluded; disputed/deposit/non-completed rows are excluded
    const futureRow = makeOutcomeRow({
      intentHash: 'fut'.padStart(64, '0'),
      anchorId: 'moneygram',
      settleSeconds: 10,
      createdAt: '2026-11-01T13:00:00.000Z', // after 12:00:00 NOW
    });
    const disputedRow = makeOutcomeRow({
      intentHash: 'disp'.padStart(64, '0'),
      anchorId: 'moneygram',
      settleSeconds: 10,
      disputed: true,
      createdAt: '2026-11-01T08:00:00.000Z',
    });
    const depositRow = makeOutcomeRow({
      intentHash: 'dep'.padStart(64, '0'),
      anchorId: 'moneygram',
      direction: 'deposit',
      settleSeconds: 10,
      createdAt: '2026-11-01T08:00:00.000Z',
    });
    const errorRow = makeOutcomeRow({
      intentHash: 'err'.padStart(64, '0'),
      anchorId: 'moneygram',
      outcome: 'error',
      settleSeconds: 10,
      createdAt: '2026-11-01T08:00:00.000Z',
    });
    const filteredSeries = buildDailyP95Series(
      [futureRow, disputedRow, depositRow, errorRow],
      { anchorId: 'moneygram' },
      { nowMs: testNow }
    );
    expect(filteredSeries.find((p) => p.day === '2026-11-01')?.sampleSize).toBe(0);

    // 6. days: 7 option -> 7 points
    const series7 = buildDailyP95Series([], { anchorId: 'moneygram' }, { nowMs: testNow, days: 7 });
    expect(series7).toHaveLength(7);
    expect(series7[0]?.day).toBe('2026-10-26');
    expect(series7[6]?.day).toBe('2026-11-01');

    // 7. buildExecutionSlaReport(...).history.length === 30 and report parses with ExecutionSlaReportSchema
    const report = buildExecutionSlaReport([], 'moneygram', { nowMs: testNow });
    expect(report.history).toHaveLength(30);
    expect(() => ExecutionSlaReportSchema.parse(report)).not.toThrow();
  });
});
