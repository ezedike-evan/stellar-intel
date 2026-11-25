import { describe, it, expect, beforeEach } from 'vitest';
import { openDisputesForOverdueRefunds } from '@/lib/refunds/escalate';
import { InMemoryRefundStore, type RefundCase } from '@/lib/refunds/store';
import { InMemoryDisputeStore } from '@/lib/reputation/disputes';
import { InMemoryAdjudicationLog } from '@/lib/reputation/adjudication-log';

function makeCase(overrides: Partial<RefundCase> = {}): RefundCase {
  return {
    id: 'case-1',
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

describe('openDisputesForOverdueRefunds (#2126)', () => {
  let refunds: InMemoryRefundStore;
  let disputes: InMemoryDisputeStore;
  let log: InMemoryAdjudicationLog;

  const NOW = new Date('2026-11-20T12:00:00.000Z');

  beforeEach(() => {
    refunds = new InMemoryRefundStore();
    disputes = new InMemoryDisputeStore();
    log = new InMemoryAdjudicationLog();
  });

  it('6-day-old owed case -> nothing opened', async () => {
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    await refunds.open(makeCase({ id: 'c1', openedAt: sixDaysAgo, status: 'owed' }));

    const res = await openDisputesForOverdueRefunds({ refunds, disputes, log, now: NOW });
    expect(res).toEqual({ scanned: 1, opened: 0 });
    expect(await disputes.list()).toHaveLength(0);
    expect(await log.list()).toHaveLength(0);
  });

  it('7 days + 1ms -> one dispute (refund_missing, subject refund/case id) and one filed log entry', async () => {
    const overdueTime = new Date(NOW.getTime() - (7 * 24 * 60 * 60 * 1000 + 1)).toISOString();
    await refunds.open(makeCase({ id: 'c-overdue', openedAt: overdueTime, status: 'owed' }));

    const res = await openDisputesForOverdueRefunds({ refunds, disputes, log, now: NOW });
    expect(res).toEqual({ scanned: 1, opened: 1 });

    const openDisputes = await disputes.list();
    expect(openDisputes).toHaveLength(1);
    const d = openDisputes[0]!;
    expect(d.category).toBe('refund_missing');
    expect(d.level).toBe('anchor');
    expect(d.subjectKind).toBe('refund');
    expect(d.subjectRef).toBe('c-overdue');
    expect(d.status).toBe('open');

    const logEntries = await log.list();
    expect(logEntries).toHaveLength(1);
    const l = logEntries[0]!;
    expect(l.action).toBe('filed');
    expect(l.category).toBe('refund_missing');
    expect(l.level).toBe('anchor');
    expect(l.rationale).toBe('Opened automatically: refund overdue.');
  });

  it('second run -> opened: 0 (idempotent)', async () => {
    const overdueTime = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await refunds.open(makeCase({ id: 'c-overdue', openedAt: overdueTime, status: 'owed' }));

    const firstRun = await openDisputesForOverdueRefunds({ refunds, disputes, log, now: NOW });
    expect(firstRun.opened).toBe(1);

    const secondRun = await openDisputesForOverdueRefunds({ refunds, disputes, log, now: NOW });
    expect(secondRun.opened).toBe(0);
    expect(await disputes.list()).toHaveLength(1);
    expect(await log.list()).toHaveLength(1);
  });

  it('refunded and acknowledged cases are ignored', async () => {
    const overdueTime = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await refunds.open(makeCase({ id: 'c-refunded', openedAt: overdueTime, status: 'refunded' }));
    await refunds.open(makeCase({ id: 'c-acked', openedAt: overdueTime, status: 'acknowledged' }));

    const res = await openDisputesForOverdueRefunds({ refunds, disputes, log, now: NOW });
    expect(res).toEqual({ scanned: 0, opened: 0 });
    expect(await disputes.list()).toHaveLength(0);
  });
});
