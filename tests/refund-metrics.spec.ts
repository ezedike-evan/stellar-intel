import { describe, expect, it } from 'vitest';
import {
  computeRefundGateMetrics,
  REFUND_ACK_GRACE_MS,
  REFUND_GATE_WINDOW_DAYS,
  REFUND_OWED_OVERDUE_MS,
} from '@/lib/refunds/metrics';
import type { RefundCase } from '@/lib/refunds/store';

const NOW = new Date('2026-11-25T12:00:00.000Z');
const WINDOW_MS = REFUND_GATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** ISO instant `ms` before NOW. */
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

let seq = 0;
function refundCase(overrides: Partial<RefundCase> = {}): RefundCase {
  seq += 1;
  return {
    id: `case-${seq}`,
    intentHash: seq.toString(16).padStart(64, '0'),
    reason: 'anchor_refunded',
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    signerAccount: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amountPaid: '100',
    status: 'refunded',
    amountRefunded: null,
    refundFee: null,
    payments: [],
    openedAt: ago(60 * 60 * 1000),
    refundedAt: ago(60 * 60 * 1000),
    acknowledgedAt: null,
    ackHash: null,
    ackSignature: null,
    onChainCheck: null,
    ...overrides,
  };
}

describe('computeRefundGateMetrics (#2121)', () => {
  it('returns all zeros and a passing gate for no cases', () => {
    expect(computeRefundGateMetrics([], NOW)).toEqual({
      windowDays: 30,
      since: new Date(NOW.getTime() - WINDOW_MS).toISOString(),
      generatedAt: NOW.toISOString(),
      opened: 0,
      owed: 0,
      refunded: 0,
      acknowledged: 0,
      awaitingAck: 0,
      unsignaled: 0,
      overdueOwed: 0,
      gatePassing: true,
    });
  });

  it('counts a refund exactly 72h old as awaiting acknowledgement', () => {
    const m = computeRefundGateMetrics(
      [refundCase({ openedAt: ago(REFUND_ACK_GRACE_MS), refundedAt: ago(REFUND_ACK_GRACE_MS) })],
      NOW
    );
    expect(m).toMatchObject({ opened: 1, refunded: 1, awaitingAck: 1, unsignaled: 0 });
    expect(m.gatePassing).toBe(true);
  });

  it('counts a refund 72h + 1ms old as unsignaled and fails the gate', () => {
    const m = computeRefundGateMetrics(
      [
        refundCase({
          openedAt: ago(REFUND_ACK_GRACE_MS + 1),
          refundedAt: ago(REFUND_ACK_GRACE_MS + 1),
        }),
      ],
      NOW
    );
    expect(m).toMatchObject({ refunded: 1, awaitingAck: 0, unsignaled: 1 });
    expect(m.gatePassing).toBe(false);
  });

  it('falls back to openedAt when refundedAt is null', () => {
    const stale = computeRefundGateMetrics(
      [refundCase({ openedAt: ago(REFUND_ACK_GRACE_MS + 1), refundedAt: null })],
      NOW
    );
    expect(stale.unsignaled).toBe(1);

    const fresh = computeRefundGateMetrics(
      [refundCase({ openedAt: ago(REFUND_ACK_GRACE_MS), refundedAt: null })],
      NOW
    );
    expect(fresh.awaitingAck).toBe(1);
    expect(fresh.unsignaled).toBe(0);
  });

  it('never counts an acknowledged case as unsignaled', () => {
    const m = computeRefundGateMetrics(
      [
        refundCase({
          status: 'acknowledged',
          openedAt: ago(20 * 24 * 60 * 60 * 1000),
          refundedAt: ago(20 * 24 * 60 * 60 * 1000),
          acknowledgedAt: ago(19 * 24 * 60 * 60 * 1000),
        }),
      ],
      NOW
    );
    expect(m).toMatchObject({ opened: 1, acknowledged: 1, awaitingAck: 0, unsignaled: 0 });
    expect(m.gatePassing).toBe(true);
  });

  it('counts an owed case 7 days + 1ms old as overdue, but not as unsignaled', () => {
    const m = computeRefundGateMetrics(
      [
        refundCase({
          status: 'owed',
          reason: 'anchor_error_after_payment',
          openedAt: ago(REFUND_OWED_OVERDUE_MS + 1),
          refundedAt: null,
        }),
        refundCase({
          status: 'owed',
          reason: 'anchor_error_after_payment',
          openedAt: ago(REFUND_OWED_OVERDUE_MS),
          refundedAt: null,
        }),
      ],
      NOW
    );
    expect(m).toMatchObject({ opened: 2, owed: 2, overdueOwed: 1, unsignaled: 0 });
    expect(m.gatePassing).toBe(true);
  });

  it('excludes a case opened 30 days + 1ms ago, and includes one opened exactly 30 days ago', () => {
    const m = computeRefundGateMetrics(
      [
        refundCase({ openedAt: ago(WINDOW_MS + 1), refundedAt: ago(WINDOW_MS + 1) }),
        refundCase({ status: 'owed', openedAt: ago(WINDOW_MS), refundedAt: null }),
      ],
      NOW
    );
    expect(m).toMatchObject({ opened: 1, owed: 1, refunded: 0, unsignaled: 0 });
  });
});
