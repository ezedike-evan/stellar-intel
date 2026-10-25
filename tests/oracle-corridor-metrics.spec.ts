import { describe, it, expect } from 'vitest';
import { deriveCorridorMetrics } from '@/lib/oracle/corridor-metrics';
import { mapOutcomeRow } from '@/lib/oracle/outcome-rows';
import type { OutcomeLogRow } from '@/types/reputation';

function row(over: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    quotedRate: '1000',
    deliveredRate: '1000',
    quotedAmount: '100',
    deliveredAmount: '100000',
    settleSeconds: 60,
    outcome: 'completed',
    createdAt: '2026-10-01T00:00:00.000Z',
    stellarTransactionId: null,
    reconciledAt: '2026-10-01T00:05:00.000Z',
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: null,
    ...over,
  };
}

describe('deriveCorridorMetrics (#1401)', () => {
  it('returns nothing for no rows', () => {
    expect(deriveCorridorMetrics([])).toEqual([]);
  });

  it('splits groups by anchor and by corridor', () => {
    const metrics = deriveCorridorMetrics([
      row({ anchorId: 'cowrie', corridor: 'usdc-ngn' }),
      row({ anchorId: 'cowrie', corridor: 'usdc-kes' }),
      row({ anchorId: 'moneygram', corridor: 'usdc-ngn' }),
      row({ anchorId: 'cowrie', corridor: 'usdc-ngn' }),
    ]);

    expect(metrics.map((m) => [m.anchorId, m.corridor, m.n])).toEqual([
      ['cowrie', 'usdc-ngn', 2],
      ['cowrie', 'usdc-kes', 1],
      ['moneygram', 'usdc-ngn', 1],
    ]);
  });

  it('does not merge ids that only differ by where a dash falls', () => {
    const metrics = deriveCorridorMetrics([
      row({ anchorId: 'a', corridor: 'b-c' }),
      row({ anchorId: 'a-b', corridor: 'c' }),
    ]);
    expect(metrics).toHaveLength(2);
  });

  it('computes fill rate as 7500 when 3 of 4 completed', () => {
    const metrics = deriveCorridorMetrics([
      row(),
      row(),
      row(),
      row({ outcome: 'error', deliveredRate: null }),
    ]);
    expect(metrics[0]?.fillRateBps).toBe(7500);
    expect(metrics[0]?.n).toBe(4);
  });

  it('takes the slippage median over completed rows, odd count', () => {
    // 1%, 2%, 5% short of the quote -> median 2% = 200 bps.
    const metrics = deriveCorridorMetrics([
      row({ deliveredRate: '990' }),
      row({ deliveredRate: '980' }),
      row({ deliveredRate: '950' }),
    ]);
    expect(metrics[0]?.slippageBps).toBe(200);
  });

  it('takes the slippage median over completed rows, even count (mean of the middle two)', () => {
    // 1%, 2%, 3%, 10% -> middle two are 2% and 3% -> 250 bps.
    const metrics = deriveCorridorMetrics([
      row({ deliveredRate: '990' }),
      row({ deliveredRate: '980' }),
      row({ deliveredRate: '970' }),
      row({ deliveredRate: '900' }),
    ]);
    expect(metrics[0]?.slippageBps).toBe(250);
  });

  it('counts a delivered rate above the quote as 0 slippage, not negative', () => {
    const metrics = deriveCorridorMetrics([
      row({ deliveredRate: '1100' }),
      row({ deliveredRate: '990' }),
      row({ deliveredRate: '1000' }),
    ]);
    // 0, 100 and 0 bps -> median 0.
    expect(metrics[0]?.slippageBps).toBe(0);
  });

  it('ignores rows without a usable delivered rate when taking the slippage median', () => {
    const metrics = deriveCorridorMetrics([
      row({ deliveredRate: '980' }),
      row({ deliveredRate: null }),
      row({ deliveredRate: '0' }),
    ]);
    expect(metrics[0]?.slippageBps).toBe(200);
  });

  it('ignores a null settle_seconds in the settle median', () => {
    const metrics = deriveCorridorMetrics([
      row({ settleSeconds: 30 }),
      row({ settleSeconds: null }),
      row({ settleSeconds: 90 }),
    ]);
    // 30 and 90 -> 60.
    expect(metrics[0]?.settleSecondsP50).toBe(60);
  });

  it('takes the settle median over completed rows only', () => {
    const metrics = deriveCorridorMetrics([
      row({ settleSeconds: 10 }),
      row({ settleSeconds: 20 }),
      row({ settleSeconds: 30 }),
      row({ outcome: 'error', settleSeconds: 9999, deliveredRate: null }),
    ]);
    expect(metrics[0]?.settleSecondsP50).toBe(20);
  });

  it('reports fill 0, slippage 0 and settle 0 for a group with no completed rows', () => {
    const metrics = deriveCorridorMetrics([
      row({ outcome: 'error', deliveredRate: null, settleSeconds: 500 }),
      row({ outcome: 'refunded', deliveredRate: null, settleSeconds: 800 }),
    ]);
    expect(metrics).toEqual([
      {
        anchorId: 'cowrie',
        corridor: 'usdc-ngn',
        fillRateBps: 0,
        slippageBps: 0,
        settleSecondsP50: 0,
        n: 2,
      },
    ]);
  });
});

describe('mapOutcomeRow', () => {
  // What `pg` returns for the tick's SELECT: snake_case, numerics as strings.
  const pgRow = {
    anchor_id: 'cowrie',
    corridor: 'usdc-ngn',
    outcome: 'completed',
    quoted_rate: '1650.5',
    delivered_rate: '1640.25',
    settle_seconds: '42',
  };

  it('maps snake_case columns to the camelCase row the derivations read', () => {
    const mapped = mapOutcomeRow(pgRow);
    expect(mapped).toMatchObject({
      anchorId: 'cowrie',
      corridor: 'usdc-ngn',
      outcome: 'completed',
      quotedRate: '1650.5',
      deliveredRate: '1640.25',
      settleSeconds: 42,
    });
  });

  it('keeps an absent delivered rate and settle time as null', () => {
    const mapped = mapOutcomeRow({ ...pgRow, delivered_rate: null, settle_seconds: null });
    expect(mapped.deliveredRate).toBeNull();
    expect(mapped.settleSeconds).toBeNull();
  });

  it('feeds the derivation correctly end to end from raw rows', () => {
    const metrics = deriveCorridorMetrics([
      mapOutcomeRow(pgRow),
      mapOutcomeRow({ ...pgRow, outcome: 'error', delivered_rate: null, settle_seconds: null }),
    ]);
    expect(metrics).toEqual([
      {
        anchorId: 'cowrie',
        corridor: 'usdc-ngn',
        fillRateBps: 5000,
        slippageBps: 62,
        settleSecondsP50: 42,
        n: 2,
      },
    ]);
  });
});
