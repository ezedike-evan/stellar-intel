import { describe, it, expect } from 'vitest';
import { computeQuoteGapStats } from '@/lib/reputation/quote-gap';
import type { OutcomeLogRow } from '@/types/reputation';

const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

let n = 0;
function row(over: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  n += 1;
  return {
    intentHash: String(n).padStart(64, '0'),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    quotedRate: '100',
    deliveredRate: '100',
    quotedAmount: '100',
    deliveredAmount: '100',
    settleSeconds: 60,
    outcome: 'completed',
    createdAt: daysAgo(1),
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: null,
    ...over,
  };
}

/** A row whose landed rate is `gapPct` percent away from a quote of 100. */
const gapRow = (gapPct: number, over: Partial<OutcomeLogRow> = {}) =>
  row({ deliveredRate: String(100 + gapPct), ...over });

const stats = (rows: OutcomeLogRow[], windowDays: 7 | 30 | 90 = 30) =>
  computeQuoteGapStats(rows, { windowDays, now: NOW });

describe('computeQuoteGapStats (#1499)', () => {
  it('reports the signed mean gap, negative when users landed less than quoted', () => {
    const result = stats([gapRow(-2), gapRow(-4), gapRow(3)]);

    expect(result.sampleCount).toBe(3);
    expect(result.meanGapPct).toBeCloseTo(-1, 9);
  });

  it('is not clamped at zero: better-than-quoted shows as a positive gap', () => {
    const result = stats([gapRow(2), gapRow(4)]);

    expect(result.meanGapPct).toBeCloseTo(3, 9);
    expect(result.p50GapPct).toBeCloseTo(2, 9);
  });

  it('takes the median of the signed gaps (nearest rank)', () => {
    const result = stats([gapRow(-5), gapRow(-1), gapRow(0), gapRow(1), gapRow(9)]);
    expect(result.p50GapPct).toBeCloseTo(0, 9);
  });

  it('takes p95 over the absolute gap, so a big shortfall and a big windfall both count', () => {
    const rows = Array.from({ length: 19 }, () => gapRow(1));
    rows.push(gapRow(-10));
    const result = stats(rows);

    // Nearest rank over 20 samples: the 19th smallest absolute gap.
    expect(result.p95AbsGapPct).toBeCloseTo(1, 9);
    expect(stats([...rows, gapRow(10)]).p95AbsGapPct).toBeCloseTo(10, 9);
  });

  it('counts worse and better separately and ignores exact matches', () => {
    const result = stats([gapRow(-1), gapRow(-2), gapRow(-3), gapRow(2), gapRow(0)]);

    expect(result.worseCount).toBe(3);
    expect(result.betterCount).toBe(1);
    expect(result.sampleCount).toBe(5);
  });

  it('keeps only rows inside the window', () => {
    const rows = [gapRow(-1, { createdAt: daysAgo(3) }), gapRow(-9, { createdAt: daysAgo(20) })];

    expect(stats(rows, 7).sampleCount).toBe(1);
    expect(stats(rows, 7).meanGapPct).toBeCloseTo(-1, 9);
    expect(stats(rows, 30).sampleCount).toBe(2);
    expect(stats(rows, 30).windowDays).toBe(30);
  });

  it('puts the window edge on the inside', () => {
    expect(stats([gapRow(-1, { createdAt: daysAgo(7) })], 7).sampleCount).toBe(1);
    expect(stats([gapRow(-1, { createdAt: daysAgo(7.01) })], 7).sampleCount).toBe(0);
  });

  it('excludes disputed rows', () => {
    const result = stats([gapRow(-1), gapRow(-50, { disputed: true })]);

    expect(result.sampleCount).toBe(1);
    expect(result.meanGapPct).toBeCloseTo(-1, 9);
  });

  it.each([
    ['refunded', { outcome: 'refunded' as const }],
    ['errored', { outcome: 'error' as const }],
    ['expired', { outcome: 'expired' as const }],
    ['without a delivered rate', { deliveredRate: null }],
    ['a deposit', { direction: 'deposit' as const }],
  ])('excludes a row that is %s', (_label, over) => {
    expect(stats([gapRow(-5, over)]).sampleCount).toBe(0);
  });

  it.each([
    ['a zero quote', { quotedRate: '0' }],
    ['a non-numeric quote', { quotedRate: 'abc' }],
    ['a non-numeric delivery', { deliveredRate: 'abc' }],
    ['an unparseable date', { createdAt: 'yesterday' }],
  ])('skips a row with %s instead of counting a zero gap', (_label, over) => {
    expect(stats([row(over)]).sampleCount).toBe(0);
  });

  it('returns nulls and a zero count with no samples', () => {
    expect(stats([])).toEqual({
      sampleCount: 0,
      meanGapPct: null,
      p50GapPct: null,
      p95AbsGapPct: null,
      worseCount: 0,
      betterCount: 0,
      windowDays: 30,
    });
  });

  it('defaults now to the current time', () => {
    const fresh = row({ deliveredRate: '99', createdAt: new Date().toISOString() });
    expect(computeQuoteGapStats([fresh], { windowDays: 7 }).sampleCount).toBe(1);
  });
});
