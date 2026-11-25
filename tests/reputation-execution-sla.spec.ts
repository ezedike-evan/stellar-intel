import { describe, it, expect } from 'vitest';
import {
  computeExecutionSla,
  computeExecutionSlaByCorridor,
  type ExecutionSla,
  ExecutionSlaSchema,
  SLA_MIN_SAMPLES,
  SLA_WINDOW_DAYS,
  settleSamplesMs,
  evaluateSlaBreach,
  buildExecutionSlaReport,
  ExecutionSlaReportSchema,
} from '@/lib/reputation/execution-sla';
import { makeOutcomeRow } from './fixtures/outcome-rows';

const NOW = Date.parse('2026-11-01T00:00:00.000Z');
const DAY_MS = 86_400_000;

function createdAt(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function expectOk(sla: ExecutionSla): Extract<ExecutionSla, { state: 'ok' }> {
  if (sla.state !== 'ok') throw new Error(`expected ok, got ${sla.state}`);
  return sla;
}

/** Rows with `settleSeconds` values drawn from `seconds(i)`, all in-window. */
function rowsWith(count: number, seconds: (index: number) => number) {
  return Array.from({ length: count }, (_, index) =>
    makeOutcomeRow({
      intentHash: `intent-${index}`,
      settleSeconds: seconds(index),
      createdAt: createdAt(-60_000),
    })
  );
}

describe('computeExecutionSla', () => {
  it('reports insufficient_data below the minimum sample size', () => {
    const result = computeExecutionSla(
      rowsWith(29, () => 60),
      { anchorId: 'moneygram' },
      {
        nowMs: NOW,
      }
    );

    expect(result.state).toBe('insufficient_data');
    expect(result.sampleSize).toBe(29);
    expect(result.terminalCount).toBe(29);
    expect(result.minSamples).toBe(SLA_MIN_SAMPLES);
    expect('p50Ms' in result).toBe(false);
  });

  it('reports insufficient_data for an empty window even when minSamples is 0', () => {
    const result = computeExecutionSla(
      [],
      { anchorId: 'moneygram' },
      { nowMs: NOW, minSamples: 0 }
    );

    expect(result.state).toBe('insufficient_data');
    expect(result.sampleSize).toBe(0);
  });

  it('computes p50 and p95 with nearest rank and withholds p99 under 100 samples', () => {
    const result = expectOk(
      computeExecutionSla(
        rowsWith(30, (index) => index + 1),
        { anchorId: 'moneygram' },
        { nowMs: NOW }
      )
    );

    expect(result.sampleSize).toBe(30);
    expect(result.p50Ms).toBe(15_000);
    expect(result.p95Ms).toBe(29_000);
    expect(result.p99Ms).toBeNull();
  });

  it('computes p50/p95/p99 from 100 samples', () => {
    const result = expectOk(
      computeExecutionSla(
        rowsWith(100, (index) => index + 1),
        { anchorId: 'moneygram' },
        { nowMs: NOW }
      )
    );

    expect(result.p50Ms).toBe(50_000);
    expect(result.p95Ms).toBe(95_000);
    expect(result.p99Ms).toBe(99_000);
  });

  it('does not trim the slow tail', () => {
    const slow = [
      ...rowsWith(98, () => 60),
      makeOutcomeRow({
        intentHash: 'slow-1',
        settleSeconds: 86_400,
        createdAt: createdAt(-60_000),
      }),
      makeOutcomeRow({
        intentHash: 'slow-2',
        settleSeconds: 86_400,
        createdAt: createdAt(-60_000),
      }),
    ];

    const result = expectOk(computeExecutionSla(slow, { anchorId: 'moneygram' }, { nowMs: NOW }));

    expect(result.sampleSize).toBe(100);
    expect(result.p99Ms).toBe(86_400_000);
  });
});

describe('window boundaries', () => {
  it('includes a row exactly at the window start and excludes the millisecond before', () => {
    const windowStartMs = NOW - SLA_WINDOW_DAYS * DAY_MS;
    const rows = [
      makeOutcomeRow({
        intentHash: 'included',
        createdAt: new Date(windowStartMs).toISOString(),
      }),
      makeOutcomeRow({
        intentHash: 'excluded-before',
        createdAt: new Date(windowStartMs - 1).toISOString(),
      }),
    ];

    const result = computeExecutionSla(rows, { anchorId: 'moneygram' }, { nowMs: NOW });

    expect(result.terminalCount).toBe(1);
    expect(result.sampleSize).toBe(1);
    expect(result.windowStart).toBe(new Date(windowStartMs).toISOString());
    expect(result.windowEnd).toBe(new Date(NOW).toISOString());
    expect(result.computedAt).toBe(result.windowEnd);
    expect(result.windowDays).toBe(SLA_WINDOW_DAYS);
  });

  it('excludes rows created after now', () => {
    const rows = [makeOutcomeRow({ intentHash: 'after', createdAt: createdAt(1) })];

    const result = computeExecutionSla(rows, { anchorId: 'moneygram' }, { nowMs: NOW });

    expect(result.terminalCount).toBe(0);
    expect(result.sampleSize).toBe(0);
  });

  it('honours the windowDays option', () => {
    const rows = [makeOutcomeRow({ intentHash: 'ten-days', createdAt: createdAt(-10 * DAY_MS) })];

    const narrow = computeExecutionSla(
      rows,
      { anchorId: 'moneygram' },
      { nowMs: NOW, windowDays: 7 }
    );
    const wide = computeExecutionSla(
      rows,
      { anchorId: 'moneygram' },
      { nowMs: NOW, windowDays: 30 }
    );

    expect(narrow.sampleSize).toBe(0);
    expect(narrow.windowDays).toBe(7);
    expect(wide.sampleSize).toBe(1);
  });
});

describe('scope and sample exclusions', () => {
  it('ignores disputed, on-ramp and other-anchor rows entirely', () => {
    const rows = [
      makeOutcomeRow({ intentHash: 'counted', createdAt: createdAt(-60_000) }),
      makeOutcomeRow({ intentHash: 'disputed', disputed: true, createdAt: createdAt(-60_000) }),
      makeOutcomeRow({
        intentHash: 'deposit',
        direction: 'deposit',
        createdAt: createdAt(-60_000),
      }),
      makeOutcomeRow({
        intentHash: 'other-anchor',
        anchorId: 'anclap',
        createdAt: createdAt(-60_000),
      }),
    ];

    const result = computeExecutionSla(rows, { anchorId: 'moneygram' }, { nowMs: NOW });

    expect(result.terminalCount).toBe(1);
    expect(result.sampleSize).toBe(1);
  });

  it('counts non-completed and untimed rows as terminal but not as samples', () => {
    const rows = [
      makeOutcomeRow({
        intentHash: 'refunded',
        outcome: 'refunded',
        createdAt: createdAt(-60_000),
      }),
      makeOutcomeRow({
        intentHash: 'untimed',
        settleSeconds: null,
        createdAt: createdAt(-60_000),
      }),
    ];

    const result = computeExecutionSla(rows, { anchorId: 'moneygram' }, { nowMs: NOW });

    expect(result.terminalCount).toBe(2);
    expect(result.sampleSize).toBe(0);
  });

  it('filters by scope.corridor and sorts the collected samples', () => {
    const rows = [
      makeOutcomeRow({
        intentHash: 'slow',
        corridor: 'usdc-ngn',
        settleSeconds: 120,
        createdAt: createdAt(-60_000),
      }),
      makeOutcomeRow({
        intentHash: 'fast',
        corridor: 'usdc-ngn',
        settleSeconds: 30,
        createdAt: createdAt(-60_000),
      }),
      makeOutcomeRow({
        intentHash: 'other-corridor',
        corridor: 'usdc-kes',
        settleSeconds: 10,
        createdAt: createdAt(-60_000),
      }),
    ];

    const scoped = settleSamplesMs(
      rows,
      { anchorId: 'moneygram', corridor: 'usdc-ngn' },
      NOW - SLA_WINDOW_DAYS * DAY_MS,
      NOW
    );

    expect(scoped.terminalCount).toBe(2);
    expect(scoped.samplesMs).toEqual([30_000, 120_000]);
  });
});

describe('computeExecutionSlaByCorridor', () => {
  it('returns one entry per corridor, sorted, with per-corridor counts', () => {
    const rows = [
      ...rowsWith(30, (index) => index + 1),
      ...Array.from({ length: 3 }, (_, index) =>
        makeOutcomeRow({
          intentHash: `kes-${index}`,
          corridor: 'usdc-kes',
          createdAt: createdAt(-60_000),
        })
      ),
      makeOutcomeRow({
        intentHash: 'deposit-only',
        corridor: 'usdc-ghs',
        direction: 'deposit',
        createdAt: createdAt(-60_000),
      }),
    ];

    const result = computeExecutionSlaByCorridor(rows, 'moneygram', { nowMs: NOW });

    expect(result.map((entry) => entry.corridor)).toEqual(['usdc-kes', 'usdc-ngn']);
    expect(result[0]!.sla.state).toBe('insufficient_data');
    expect(result[0]!.sla.sampleSize).toBe(3);
    expect(result[1]!.sla.state).toBe('ok');
    expect(result[1]!.sla.sampleSize).toBe(30);
    expect(result[1]!.sla.windowEnd).toBe(result[0]!.sla.windowEnd);
  });
});

describe('options', () => {
  it('honours minSamples', () => {
    const rows = rowsWith(10, () => 60);

    const loose = computeExecutionSla(
      rows,
      { anchorId: 'moneygram' },
      { nowMs: NOW, minSamples: 10 }
    );
    const strict = computeExecutionSla(
      rows,
      { anchorId: 'moneygram' },
      { nowMs: NOW, minSamples: 11 }
    );

    expect(loose.state).toBe('ok');
    expect(loose.minSamples).toBe(10);
    expect(strict.state).toBe('insufficient_data');
    expect(strict.minSamples).toBe(11);
  });
});

describe('ExecutionSlaSchema', () => {
  const ok = computeExecutionSla(
    rowsWith(100, (index) => index + 1),
    { anchorId: 'moneygram' },
    { nowMs: NOW }
  );
  const insufficient = computeExecutionSla(
    rowsWith(1, () => 60),
    { anchorId: 'moneygram' },
    {
      nowMs: NOW,
    }
  );

  it('accepts both states', () => {
    expect(ExecutionSlaSchema.parse(ok)).toEqual(ok);
    expect(ExecutionSlaSchema.parse(insufficient)).toEqual(insufficient);
  });

  it('accepts a null p99', () => {
    const noP99 = computeExecutionSla(
      rowsWith(30, () => 60),
      { anchorId: 'moneygram' },
      {
        nowMs: NOW,
      }
    );
    expect(ExecutionSlaSchema.parse(noP99)).toEqual(noP99);
  });

  it('rejects an ok object without p95Ms', () => {
    const { p95Ms: _p95Ms, ...withoutP95 } = ok as Extract<typeof ok, { state: 'ok' }>;
    expect(ExecutionSlaSchema.safeParse(withoutP95).success).toBe(false);
  });
});

// ─── SLA003: breach thresholds and the report ───

const K_NOW = Date.parse('2026-06-04T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(K_NOW - h * 3_600_000).toISOString();

const slaBase = {
  windowDays: 30,
  windowStart: new Date(K_NOW - 30 * 86_400_000).toISOString(),
  windowEnd: new Date(K_NOW).toISOString(),
  terminalCount: 100,
  minSamples: 30,
  computedAt: new Date(K_NOW).toISOString(),
};
const insufficientSla = (): ExecutionSla => ({
  ...slaBase,
  state: 'insufficient_data',
  sampleSize: 10,
});
const okSla = (p95Ms: number, p99Ms: number | null): ExecutionSla => ({
  ...slaBase,
  state: 'ok',
  sampleSize: 100,
  p50Ms: 60_000,
  p95Ms,
  p99Ms,
});

describe('evaluateSlaBreach', () => {
  const thresholds = { p95Ms: 15 * 60 * 1000, p99Ms: 60 * 60 * 1000 };

  it('evaluates unknown for insufficient_data', () => {
    const sla = insufficientSla();
    const assessment = evaluateSlaBreach(sla, thresholds);
    expect(assessment.status).toBe('unknown');
    expect(assessment.breaches).toHaveLength(0);
  });

  it('evaluates within when both percentiles are below or equal to thresholds', () => {
    const sla = okSla(thresholds.p95Ms, thresholds.p99Ms);
    const assessment = evaluateSlaBreach(sla, thresholds);
    expect(assessment.status).toBe('within');
    expect(assessment.breaches).toHaveLength(0);
  });

  it('evaluates breach when p95 exceeds threshold', () => {
    const sla = okSla(thresholds.p95Ms + 1000, thresholds.p99Ms - 1000);
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
    const sla = okSla(thresholds.p95Ms - 1000, thresholds.p99Ms + 5000);
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
    const sla = okSla(thresholds.p95Ms - 1000, null);
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

    const report = buildExecutionSlaReport(rows, 'moneygram', { nowMs: K_NOW });

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
      nowMs: K_NOW,
      corridor: 'usdc-ngn',
    });

    expect(report.corridors).toHaveLength(1);
    expect(report.corridors[0]?.corridor).toBe('usdc-ngn');
    expect(report.corridors[0]?.sla.state).toBe('ok');
  });
});
