import { REFUND_OWED_OVERDUE_MS, type RefundCase } from './store';

// ─── Refund release-gate metric (Issue #2121) ───────────────────────────────────
//
// The v3 release gate reads "0 unsignaled refunds in the trailing 30 days". This
// is the one place that gate is defined, so anyone can recompute it from the cases
// and the public GET /api/v1/refunds/summary serves exactly this result.
//
// The result is counts only: no accounts, no intent hashes, no amounts.

/** Trailing window, in days, the gate is evaluated over (by a case's openedAt). */
export const REFUND_GATE_WINDOW_DAYS = 30;

/**
 * How long, from the moment an anchor refunded (refundedAt, else openedAt), the user
 * has to sign the acknowledgement before the refund counts as unsignaled. Exactly
 * 72 hours old is still within grace.
 */
export const REFUND_ACK_GRACE_MS = 72 * 60 * 60 * 1000;

/**
 * An owed case older than this (from openedAt) is overdue. Re-exported from the store
 * so the escalation job, the anchor stats and this metric share one definition.
 */
export { REFUND_OWED_OVERDUE_MS };

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RefundGateMetrics {
  /** Always REFUND_GATE_WINDOW_DAYS. */
  windowDays: number;
  /** ISO start of the window: cases opened at or after it are counted. */
  since: string;
  /** ISO instant the metric was computed at. */
  generatedAt: string;
  /** Cases opened in the window. */
  opened: number;
  /** Cases in the window by status. */
  owed: number;
  refunded: number;
  acknowledged: number;
  /** Refunded, not yet acknowledged, still within REFUND_ACK_GRACE_MS. */
  awaitingAck: number;
  /** Refunded, not acknowledged, and past REFUND_ACK_GRACE_MS. The gate counts these. */
  unsignaled: number;
  /** Owed for longer than REFUND_OWED_OVERDUE_MS. Reported, but not part of the gate. */
  overdueOwed: number;
  /** True when unsignaled is 0. */
  gatePassing: boolean;
}

function parseMs(iso: string): number {
  return Date.parse(iso);
}

/** Start of the gate window ending at `now`. */
export function refundGateWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - REFUND_GATE_WINDOW_DAYS * DAY_MS);
}

/**
 * Classifies every refund case opened in the trailing REFUND_GATE_WINDOW_DAYS and
 * returns the counts the release gate reads. Cases opened before the window, or
 * with an unparseable openedAt, are ignored.
 */
export function computeRefundGateMetrics(
  cases: readonly RefundCase[],
  now: Date = new Date()
): RefundGateMetrics {
  const nowMs = now.getTime();
  const since = refundGateWindowStart(now);
  const sinceMs = since.getTime();

  const metrics: RefundGateMetrics = {
    windowDays: REFUND_GATE_WINDOW_DAYS,
    since: since.toISOString(),
    generatedAt: now.toISOString(),
    opened: 0,
    owed: 0,
    refunded: 0,
    acknowledged: 0,
    awaitingAck: 0,
    unsignaled: 0,
    overdueOwed: 0,
    gatePassing: true,
  };

  for (const c of cases) {
    const openedMs = parseMs(c.openedAt);
    if (Number.isNaN(openedMs) || openedMs < sinceMs) continue;

    metrics.opened += 1;

    switch (c.status) {
      case 'owed':
        metrics.owed += 1;
        if (nowMs - openedMs > REFUND_OWED_OVERDUE_MS) metrics.overdueOwed += 1;
        break;
      case 'refunded': {
        metrics.refunded += 1;
        const refundedMs = c.refundedAt !== null ? parseMs(c.refundedAt) : NaN;
        const age = nowMs - (Number.isNaN(refundedMs) ? openedMs : refundedMs);
        if (age <= REFUND_ACK_GRACE_MS) metrics.awaitingAck += 1;
        else metrics.unsignaled += 1;
        break;
      }
      case 'acknowledged':
        metrics.acknowledged += 1;
        break;
    }
  }

  metrics.gatePassing = metrics.unsignaled === 0;
  return metrics;
}
