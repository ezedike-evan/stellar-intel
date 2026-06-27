import { describe, it, expect } from 'vitest';
import {
  aggregate,
  buildScorecards,
  percentile,
  MIN_SAMPLES,
  type OutcomeRow,
  type Window,
} from '@/lib/reputation/aggregate';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2025-01-30T00:00:00Z').getTime();
const daysAgo = (d: number): number => NOW - d * 86_400_000;

function makeRow(overrides: Partial<OutcomeRow> = {}): OutcomeRow {
  return {
    intentHash: 'abc123',
    anchorId: 'anchor-a',
    filled: true,
    settleMs: 5_000,
    slippage: 0.01,
    recordedAt: daysAgo(1),
    ...overrides,
  };
}

// ─── Sample dataset ───────────────────────────────────────────────────────────
//
// 10 rows within the last 7 days
// 20 additional rows between 8–30 days ago
// 15 additional rows between 31–90 days ago

const SAMPLE_ROWS: OutcomeRow[] = [
  // ── 7-day window (10 rows) ──
  makeRow({ intentHash: 'h01', settleMs: 2_000, slippage: 0.005, recordedAt: daysAgo(1) }),
  makeRow({ intentHash: 'h02', settleMs: 3_000, slippage: 0.008, recordedAt: daysAgo(2) }),
  makeRow({ intentHash: 'h03', settleMs: 4_000, slippage: 0.01, recordedAt: daysAgo(3) }),
  makeRow({ intentHash: 'h04', settleMs: 5_000, slippage: 0.012, recordedAt: daysAgo(4) }),
  makeRow({
    intentHash: 'h05',
    settleMs: 6_000,
    slippage: 0.015,
    recordedAt: daysAgo(5),
    filled: false,
  }),
  makeRow({ intentHash: 'h06', settleMs: 7_000, slippage: 0.018, recordedAt: daysAgo(5) }),
  makeRow({ intentHash: 'h07', settleMs: 8_000, slippage: 0.02, recordedAt: daysAgo(6) }),
  makeRow({ intentHash: 'h08', settleMs: 9_000, slippage: 0.022, recordedAt: daysAgo(6) }),
  makeRow({
    intentHash: 'h09',
    settleMs: 10_000,
    slippage: 0.025,
    recordedAt: daysAgo(6),
    filled: false,
  }),
  makeRow({ intentHash: 'h10', settleMs: 12_000, slippage: 0.03, recordedAt: daysAgo(6) }),
  // ── 30-day window extras (20 rows) ──
  ...Array.from({ length: 20 }, (_, i) =>
    makeRow({
      intentHash: `m${i}`,
      settleMs: 4_000 + i * 200,
      slippage: 0.01,
      recordedAt: daysAgo(8 + i),
    })
  ),
  // ── 90-day window extras (15 rows) ──
  ...Array.from({ length: 15 }, (_, i) =>
    makeRow({
      intentHash: `q${i}`,
      settleMs: 6_000 + i * 300,
      slippage: 0.02,
      recordedAt: daysAgo(31 + i),
    })
  ),
];

// ─── percentile helper ────────────────────────────────────────────────────────

describe('percentile', () => {
  it('returns the single value for a one-element array', () => {
    expect(percentile([42], 50)).toBe(42);
  });

  it('returns 0 for an empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('p50 of [1,2,3,4,5] is 3', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('p95 of [1..20] is close to 19.05', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(arr, 95)).toBeCloseTo(19.05, 1);
  });
});

// ─── aggregate ────────────────────────────────────────────────────────────────

describe('aggregate', () => {
  it('returns insufficient_data when there are no rows', () => {
    const result = aggregate([], 7, NOW);
    expect(result.state).toBe('insufficient_data');
    expect(result.sampleSize).toBe(0);
  });

  it('returns insufficient_data when all rows are outside the window', () => {
    const oldRow = makeRow({ recordedAt: daysAgo(100) });
    const result = aggregate([oldRow], 7, NOW);
    expect(result.state).toBe('insufficient_data');
  });

  it('7-day window covers exactly 10 sample rows', () => {
    const result = aggregate(SAMPLE_ROWS, 7, NOW);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.sampleSize).toBe(10);
    expect(result.window).toBe(7);
  });

  it('30-day window covers 30 sample rows', () => {
    const result = aggregate(SAMPLE_ROWS, 30, NOW);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.sampleSize).toBe(30);
  });

  it('90-day window covers all 45 sample rows', () => {
    const result = aggregate(SAMPLE_ROWS, 90, NOW);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.sampleSize).toBe(45);
  });

  it('fill rate is correct for 7-day window (8/10 filled)', () => {
    const result = aggregate(SAMPLE_ROWS, 7, NOW);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.fillRate).toBeCloseTo(0.8, 5);
  });

  it('settle p50 is within expected range for 7-day window', () => {
    const result = aggregate(SAMPLE_ROWS, 7, NOW);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    // settle times in 7-day window: [2k, 3k, 4k, 5k, 6k, 7k, 8k, 9k, 10k, 12k]
    // p50 = median of 10 values = avg of 5th and 6th = (6000+7000)/2 = 6500
    expect(result.settleMs.p50).toBeCloseTo(6_500, 0);
  });

  it('settle p95 is within expected range for 7-day window', () => {
    const result = aggregate(SAMPLE_ROWS, 7, NOW);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.settleMs.p95).toBeGreaterThan(10_000);
    expect(result.settleMs.p95).toBeLessThanOrEqual(12_000);
  });

  it('slippage p50 is in expected range for 7-day window', () => {
    const result = aggregate(SAMPLE_ROWS, 7, NOW);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.slippage.p50).toBeGreaterThan(0.01);
    expect(result.slippage.p50).toBeLessThan(0.025);
  });

  it('empty aggregate returns insufficient_data state with sampleSize 0', () => {
    const windows: Window[] = [7, 30, 90];
    for (const w of windows) {
      const result = aggregate([], w, NOW);
      expect(result).toMatchObject({ state: 'insufficient_data', window: w, sampleSize: 0 });
    }
  });
});

// ─── buildScorecards ──────────────────────────────────────────────────────────

describe('buildScorecards', () => {
  it('returns scorecards for all three windows', () => {
    const cards = buildScorecards(SAMPLE_ROWS, NOW);
    expect(cards[7]).toBeDefined();
    expect(cards[30]).toBeDefined();
    expect(cards[90]).toBeDefined();
  });

  it('window field matches the key', () => {
    const cards = buildScorecards(SAMPLE_ROWS, NOW);
    expect(cards[7].window).toBe(7);
    expect(cards[30].window).toBe(30);
    expect(cards[90].window).toBe(90);
  });

  it('all three windows are insufficient_data when rows array is empty', () => {
    const cards = buildScorecards([], NOW);
    expect(cards[7].state).toBe('insufficient_data');
    expect(cards[30].state).toBe('insufficient_data');
    expect(cards[90].state).toBe('insufficient_data');
  });

  it('sample data produces expected aggregates end-to-end', () => {
    const cards = buildScorecards(SAMPLE_ROWS, NOW);

    // 7-day
    expect(cards[7].state).toBe('ok');
    if (cards[7].state === 'ok') {
      expect(cards[7].sampleSize).toBe(10);
      expect(cards[7].fillRate).toBeCloseTo(0.8, 5);
      expect(cards[7].settleMs.p50).toBeGreaterThan(0);
      expect(cards[7].settleMs.p95).toBeGreaterThanOrEqual(cards[7].settleMs.p50);
      expect(cards[7].slippage.p50).toBeGreaterThan(0);
      expect(cards[7].slippage.p95).toBeGreaterThanOrEqual(cards[7].slippage.p50);
    }

    // 90-day has more data than 7-day
    expect(cards[90].state).toBe('ok');
    if (cards[90].state === 'ok' && cards[7].state === 'ok') {
      expect(cards[90].sampleSize).toBeGreaterThan(cards[7].sampleSize);
    }
  });

  it('MIN_SAMPLES boundary — exactly MIN_SAMPLES rows returns ok', () => {
    const minRows = Array.from({ length: MIN_SAMPLES }, (_, i) =>
      makeRow({ intentHash: `min${i}`, recordedAt: daysAgo(1) })
    );
    const cards = buildScorecards(minRows, NOW);
    expect(cards[7].state).toBe('ok');
  });
});
