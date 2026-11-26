import type { OutcomeLogRow } from '@/types/reputation';
import { getReputationStore, type ReputationStore } from '@/lib/reputation/store';
import { emitWebhookEvent } from '@/lib/webhooks/emit';
import { getRefundStore, type RefundCase, type RefundReason, type RefundStore } from './store';

/**
 * Tells webhook subscribers a refund is now tracked (#2124). The payload is built field
 * by field so the signer account, the acknowledgement proof and the amounts never leave
 * the platform. Only called once a case was actually inserted.
 */
export function emitRefundOpened(record: RefundCase): void {
  emitWebhookEvent(
    'refund.opened',
    {
      caseId: record.id,
      intentHash: record.intentHash,
      anchorId: record.anchorId,
      corridor: record.corridor,
      direction: record.direction,
      reason: record.reason,
      // A new case is owed or already refunded; it is never opened acknowledged.
      status: record.status === 'refunded' ? 'refunded' : 'owed',
      openedAt: record.openedAt,
    },
    { idempotencyKey: `refund.opened:${record.id}` }
  );
}

// ─── Automatic refund detection (Issue #2115 / RFD004) ────────────────────────
//
// The "automatic" half of refund guarantees: the moment a signed outcome says
// the anchor refunded, or that a withdrawal failed after the user's USDC
// already left their wallet, Stellar Intel starts tracking a refund without
// anyone filing anything. Only attested outcomes count — a row nobody signed
// cannot prove a fiat payment happened.

/** Which refund, if any, an outcome row implies. Nothing else opens a case. */
export function detectRefundReason(row: OutcomeLogRow): RefundReason | null {
  if (row.outcome === 'refunded') return 'anchor_refunded';
  if (row.direction === 'withdraw' && row.stellarTransactionId !== null) {
    if (row.outcome === 'error') return 'anchor_error_after_payment';
    if (row.outcome === 'expired') return 'expired_after_payment';
  }
  return null;
}

/** Builds the case for a detected reason, or null when the row is unattested. */
export function refundCaseFromOutcome(
  row: OutcomeLogRow,
  reason: RefundReason,
  now: Date = new Date()
): RefundCase | null {
  if (row.signerAccount === null || !row.attested) return null;
  return {
    id: globalThis.crypto.randomUUID(),
    intentHash: row.intentHash,
    reason,
    anchorId: row.anchorId,
    corridor: row.corridor,
    direction: row.direction,
    signerAccount: row.signerAccount,
    amountPaid: row.quotedAmount,
    status: reason === 'anchor_refunded' ? 'refunded' : 'owed',
    amountRefunded: null,
    refundFee: null,
    payments: [],
    openedAt: now.toISOString(),
    refundedAt: reason === 'anchor_refunded' ? now.toISOString() : null,
    acknowledgedAt: null,
    ackHash: null,
    ackSignature: null,
    onChainCheck: null,
  };
}

/**
 * Opens the case for an outcome row, if it implies one. Returns the case when
 * it was inserted, null when nothing was implied, the row was unattested, or
 * a case for the same (intentHash, reason) already exists.
 */
export async function openRefundCaseForOutcome(
  row: OutcomeLogRow,
  store: RefundStore = getRefundStore()
): Promise<RefundCase | null> {
  const reason = detectRefundReason(row);
  if (reason === null) return null;
  const record = refundCaseFromOutcome(row, reason);
  if (record === null) return null;
  const inserted = await store.open(record);
  if (!inserted) return null;
  emitRefundOpened(record);
  return record;
}

/**
 * Opens a refund case for a slippage breach (RFD014).
 * Loads the attested outcome by intentHash and creates an 'owed' case with
 * reason 'slippage_breach'.
 */
export async function openRefundCaseForBreach(
  breach: { intentHash: string },
  deps?: { refunds?: RefundStore; outcomes?: Pick<ReputationStore, 'query'> }
): Promise<RefundCase | null> {
  const outcomes = deps?.outcomes ?? getReputationStore();
  const refunds = deps?.refunds ?? getRefundStore();

  const rows = await outcomes.query({ intentHash: breach.intentHash, includeUnattested: false });
  const row = rows[0];
  if (!row) return null;

  const record = refundCaseFromOutcome(row, 'slippage_breach');
  if (!record) return null;

  record.status = 'owed';
  record.refundedAt = null;

  // No refund.opened here: the append route emits it for a breach case itself, after
  // the outcome's own events and intent.slippage_breach, so subscribers see them in order.
  const inserted = await refunds.open(record);
  return inserted ? record : null;
}
