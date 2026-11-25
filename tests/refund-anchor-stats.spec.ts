import { describe, it, expect } from 'vitest';
import { computeAnchorRefundStats } from '@/lib/refunds/anchor-stats';
import type { RefundCase } from '@/lib/refunds/store';

function makeCase(overrides: Partial<RefundCase> = {}): RefundCase {
  return {
    id: 'test-case-id',
    intentHash: 'a'.repeat(64),
    reason: 'anchor_error_after_payment',
    anchorId: 'test-anchor',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    amountPaid: '100',
    status: 'owed',
    amountRefunded: null,
    refundFee: null,
    payments: [],
    openedAt: new Date().toISOString(),
    refundedAt: null,
    acknowledgedAt: null,
    ackHash: null,
    ackSignature: null,
    onChainCheck: null,
    ...overrides,
  };
}

describe('computeAnchorRefundStats (#2122)', () => {
  const NOW = new Date('2026-11-20T12:00:00.000Z');

  it('empty -> zeros and median: null', () => {
    const stats = computeAnchorRefundStats([], NOW);
    expect(stats).toEqual({
      windowDays: 90,
      total: 0,
      refunded: 0,
      acknowledged: 0,
      overdueOwed: 0,
      medianHoursToRefund: null,
    });
  });

  it('91-day-old case is excluded from stats', () => {
    const oldCase = makeCase({
      openedAt: new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'refunded',
      refundedAt: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const stats = computeAnchorRefundStats([oldCase], NOW);
    expect(stats.total).toBe(0);
    expect(stats.refunded).toBe(0);
    expect(stats.medianHoursToRefund).toBeNull();
  });

  it('calculates median hours to refund correctly (median of 2h, 4h, 10h = 4)', () => {
    const case1 = makeCase({
      openedAt: new Date(NOW.getTime() - 20 * 3600 * 1000).toISOString(),
      refundedAt: new Date(NOW.getTime() - 18 * 3600 * 1000).toISOString(), // 2h
      status: 'refunded',
    });
    const case2 = makeCase({
      openedAt: new Date(NOW.getTime() - 15 * 3600 * 1000).toISOString(),
      refundedAt: new Date(NOW.getTime() - 11 * 3600 * 1000).toISOString(), // 4h
      status: 'refunded',
    });
    const case3 = makeCase({
      openedAt: new Date(NOW.getTime() - 30 * 3600 * 1000).toISOString(),
      refundedAt: new Date(NOW.getTime() - 20 * 3600 * 1000).toISOString(), // 10h
      status: 'refunded',
    });

    const stats = computeAnchorRefundStats([case1, case2, case3], NOW);
    expect(stats.total).toBe(3);
    expect(stats.refunded).toBe(3);
    expect(stats.medianHoursToRefund).toBe(4);
  });

  it('anchor_refunded cases are excluded from the median but counted in refunded', () => {
    const autoCase = makeCase({
      reason: 'anchor_refunded',
      openedAt: new Date(NOW.getTime() - 10 * 3600 * 1000).toISOString(),
      refundedAt: new Date(NOW.getTime() - 10 * 3600 * 1000).toISOString(),
      status: 'refunded',
    });
    const regularCase = makeCase({
      reason: 'expired_after_payment',
      openedAt: new Date(NOW.getTime() - 10 * 3600 * 1000).toISOString(),
      refundedAt: new Date(NOW.getTime() - 5 * 3600 * 1000).toISOString(), // 5h
      status: 'refunded',
    });

    const stats = computeAnchorRefundStats([autoCase, regularCase], NOW);
    expect(stats.total).toBe(2);
    expect(stats.refunded).toBe(2);
    expect(stats.medianHoursToRefund).toBe(5);
  });

  it('counts overdue owed refunds (>7 days)', () => {
    const overdueCase = makeCase({
      openedAt: new Date(NOW.getTime() - 8 * 24 * 3600 * 1000).toISOString(), // 8 days ago
      status: 'owed',
    });
    const freshOwedCase = makeCase({
      openedAt: new Date(NOW.getTime() - 2 * 24 * 3600 * 1000).toISOString(), // 2 days ago
      status: 'owed',
    });

    const stats = computeAnchorRefundStats([overdueCase, freshOwedCase], NOW);
    expect(stats.total).toBe(2);
    expect(stats.refunded).toBe(0);
    expect(stats.overdueOwed).toBe(1);
  });
});
