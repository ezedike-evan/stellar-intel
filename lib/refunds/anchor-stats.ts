import type { RefundCase } from './store';
import { REFUND_OWED_OVERDUE_MS } from './store';

export interface AnchorRefundStats {
  windowDays: 90;
  total: number;
  refunded: number;
  acknowledged: number;
  overdueOwed: number;
  medianHoursToRefund: number | null;
}

export function computeAnchorRefundStats(
  cases: readonly RefundCase[],
  now: Date = new Date()
): AnchorRefundStats {
  const windowMs = 90 * 24 * 60 * 60 * 1000;
  const cutoffMs = now.getTime() - windowMs;

  const inWindow = cases.filter((c) => {
    const t = new Date(c.openedAt).getTime();
    return !Number.isNaN(t) && t >= cutoffMs && t <= now.getTime();
  });

  let refunded = 0;
  let acknowledged = 0;
  let overdueOwed = 0;
  const durationsHours: number[] = [];

  for (const c of inWindow) {
    if (c.status === 'refunded' || c.status === 'acknowledged') {
      refunded++;
    }
    if (c.status === 'acknowledged') {
      acknowledged++;
    }
    if (c.status === 'owed') {
      const openedMs = new Date(c.openedAt).getTime();
      if (now.getTime() - openedMs > REFUND_OWED_OVERDUE_MS) {
        overdueOwed++;
      }
    }
    if (c.reason !== 'anchor_refunded' && c.refundedAt !== null) {
      const openedMs = new Date(c.openedAt).getTime();
      const refMs = new Date(c.refundedAt).getTime();
      if (!Number.isNaN(openedMs) && !Number.isNaN(refMs) && refMs >= openedMs) {
        durationsHours.push((refMs - openedMs) / 3_600_000);
      }
    }
  }

  let medianHoursToRefund: number | null = null;
  if (durationsHours.length > 0) {
    durationsHours.sort((a, b) => a - b);
    const mid = Math.floor(durationsHours.length / 2);
    const raw =
      durationsHours.length % 2 === 1
        ? durationsHours[mid]!
        : (durationsHours[mid - 1]! + durationsHours[mid]!) / 2;
    medianHoursToRefund = Math.round(raw * 10) / 10;
  }

  return {
    windowDays: 90,
    total: inWindow.length,
    refunded,
    acknowledged,
    overdueOwed,
    medianHoursToRefund,
  };
}
