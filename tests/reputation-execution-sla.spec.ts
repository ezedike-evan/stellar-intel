import { describe, it, expect } from 'vitest';
import {
  computeExecutionSla,
  computeExecutionSlaByCorridor,
  ExecutionSlaSchema,
  SLA_MIN_SAMPLES,
  SLA_P99_MIN_SAMPLES,
  SLA_WINDOW_DAYS,
  settleSamplesMs,
} from '@/lib/reputation/execution-sla';
import { makeOutcomeRow } from './fixtures/outcome-rows';

const NOW = Date.parse('2026-11-01T00:00:00.000Z');
const DAY_MS = 86_400_000;

function createdAt(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
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

  it('computes p50 and p95 with nearest rank and withholds p99 under 100 samples', () => {
    const result = computeExecutionSla(
      rowsWith(30, (index) => index + 1),
      { anchorId: 'moneygram' },
      { nowMs: NOW }
    );

    expect(result.state).toBe('ok');
    if (result.state !== 'ok') throw new Error('unreachable');
    expect(result.sampleSize).toBe(30);
    expect(result.p50Ms).toBe(15_000);
    expect(result.p95Ms).toBe(29_000);
    expect(result.p99Ms).toBeNull();
  });

  it('computes p50/p95/p99 from 100 samples', () => {
    const result = computeExecutionSla(
      rowsWith(100, (index) => index + 1),
      { anchorId: 'moneygram' },
      { nowMs: NOW }
    );

    expect(result.state).toBe('ok');
    if (result.state !== 'ok') throw new Error('unreachable');
    expect(result.p50Ms).toBe(50_000);
    expect(result.p95Ms).toBe(95_000);
    expect(result.p99Ms).toBe(99_000);
    expect(SLA_P99_MIN_SAMPLES).toBe(100);
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

    const result = computeExecutionSla(slow, { anchorId: 'moneygram' }, { nowMs: NOW });

    expect(result.state).toBe('ok');
    if (result.state !== 'ok') throw new Error('unreachable');
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
