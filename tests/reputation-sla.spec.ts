import { describe, it, expect } from 'vitest';
import {
  SLA_CAP_USD,
  DEFAULT_SLA_UNDERWRITING,
  assessSlaEligibility,
  isAmountCovered,
  assessPayout,
  type SlaClaim,
} from '@/lib/reputation/sla';
import type { CorridorAggregate } from '@/lib/reputation/aggregate';

function aggregate(overrides?: Partial<CorridorAggregate>): CorridorAggregate {
  return {
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    windowDays: 90,
    bucketStart: new Date(),
    txCount: 500,
    successCount: 495, // 99%
    avgSettlementMs: 120_000,
    p50SettlementMs: 90_000,
    p95SettlementMs: 5 * 60 * 1000, // 5 min, within the 15 min ceiling
    compositeScore: 1.1,
    lastRefresh: new Date(),
    ...overrides,
  };
}

describe('assessSlaEligibility (#814)', () => {
  it('underwrites a pair whose actuarial aggregate clears every threshold', () => {
    const result = assessSlaEligibility(aggregate());
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.capUsd).toBe(100);
    expect(result.windowDays).toBe(90);
    // guaranteed deadline = p95 (300000) × margin (1.5)
    expect(result.guaranteedSettlementMs).toBe(450_000);
  });

  it('fails closed on an insufficient sample', () => {
    const result = assessSlaEligibility(aggregate({ txCount: 10, successCount: 10 }));
    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.reasons.some((r) => r.includes('insufficient sample'))).toBe(true);
  });

  it('fails closed on a low fill rate', () => {
    const result = assessSlaEligibility(aggregate({ txCount: 500, successCount: 400 })); // 80%
    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.reasons.some((r) => r.includes('fill rate'))).toBe(true);
  });

  it('fails closed when p95 latency or composite data is missing', () => {
    const result = assessSlaEligibility(aggregate({ p95SettlementMs: null, compositeScore: null }));
    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.reasons.some((r) => r.includes('p95 settlement'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('composite'))).toBe(true);
  });

  it('fails closed on a short actuarial window', () => {
    const result = assessSlaEligibility(aggregate({ windowDays: 7 }));
    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.reasons.some((r) => r.includes('90-day window'))).toBe(true);
  });
});

describe('isAmountCovered — $100 cap', () => {
  it('covers positive amounts up to the cap and rejects the rest', () => {
    expect(isAmountCovered(1)).toBe(true);
    expect(isAmountCovered(SLA_CAP_USD)).toBe(true);
    expect(isAmountCovered(SLA_CAP_USD + 0.01)).toBe(false);
    expect(isAmountCovered(0)).toBe(false);
    expect(isAmountCovered(-5)).toBe(false);
  });
});

describe('assessPayout (#814)', () => {
  const base: SlaClaim = {
    amountUsd: 100,
    outcome: 'completed',
    settleSeconds: 120,
    guaranteedSettlementMs: 450_000,
  };

  it('pays out (capped) on a breach outcome', () => {
    const result = assessPayout({ ...base, outcome: 'refunded', settleSeconds: null });
    expect(result).toEqual({ payable: true, amountUsd: 100, reason: 'breach_outcome' });
  });

  it('pays out on a latency breach (completed but too slow)', () => {
    const result = assessPayout({ ...base, settleSeconds: 600 }); // 600s = 600000ms > 450000
    expect(result.payable).toBe(true);
    if (!result.payable) return;
    expect(result.reason).toBe('latency_breach');
  });

  it('does not pay out on a clean, on-time settlement', () => {
    expect(assessPayout(base).payable).toBe(false);
  });

  it('never pays out above the $100 cap', () => {
    const result = assessPayout({ ...base, amountUsd: 250, outcome: 'error', settleSeconds: null });
    // Amount exceeds the cap, so the intent was never covered.
    expect(result.payable).toBe(false);
  });

  it('caps the payout at $100 for a covered breach', () => {
    const result = assessPayout({ ...base, amountUsd: 100, outcome: 'error', settleSeconds: null });
    expect(result.payable).toBe(true);
    if (!result.payable) return;
    expect(result.amountUsd).toBeLessThanOrEqual(SLA_CAP_USD);
  });

  it('uses the configured default window of 90 days', () => {
    expect(DEFAULT_SLA_UNDERWRITING.requiredWindowDays).toBe(90);
  });
});
