import { publicDisputeRef, type AdjudicationLogStore } from './adjudication-log';
import { isOverdue, levelDeadline } from './dispute-ladder';
import type { DisputeStore } from './disputes';

export interface SweepDeps {
  disputes: DisputeStore;
  log: AdjudicationLogStore;
  now?: Date;
}

export interface SweepResult {
  scanned: number;
  escalated: number;
}

const ANCHOR_TIMEOUT_RATIONALE = 'Anchor did not respond within 72 hours.';

/**
 * Moves every open dispute that sat at the anchor rung past its deadline to
 * maintainer review and records the move in the public adjudication log.
 *
 * Overdue disputes at `review` or `appeal` are left alone, because a human has
 * to decide those. A second run finds nothing left at the anchor rung, so the
 * sweep is idempotent.
 */
export async function escalateOverdueDisputes(deps: SweepDeps): Promise<SweepResult> {
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();

  const open = (await deps.disputes.list()).filter((d) => d.status === 'open');
  let escalated = 0;

  for (const dispute of open) {
    if (dispute.level !== 'anchor' || !isOverdue(dispute, now)) continue;

    const reviewDeadline = levelDeadline('review', nowIso);
    const moved = await deps.disputes.escalate(dispute.id, 'review', reviewDeadline);
    // Resolved by someone else between the list and the escalate; nothing to log.
    if (!moved) continue;

    await deps.log.append({
      action: 'escalated',
      level: 'review',
      rationale: ANCHOR_TIMEOUT_RATIONALE,
      disputeRef: publicDisputeRef(dispute.id),
      anchorId: dispute.anchorId,
      category: dispute.category,
      decidedAt: nowIso,
    });
    escalated++;
  }

  return { scanned: open.length, escalated };
}
