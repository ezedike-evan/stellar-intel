import type { DisputeStore } from './disputes';
import type { AdjudicationLogStore } from './adjudication-log';
import { isOverdue, levelDeadline } from './dispute-ladder';
import { publicDisputeRef } from './adjudication-log';

export async function escalateOverdueDisputes(deps: {
  disputes: DisputeStore;
  log: AdjudicationLogStore;
  now?: Date;
}): Promise<{ scanned: number; escalated: number }> {
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const disputes = await deps.disputes.list();

  let escalated = 0;
  for (const d of disputes) {
    if (d.status === 'open' && d.level === 'anchor' && isOverdue(d, now)) {
      const nextLvlDeadline = levelDeadline('review', nowIso);
      const updated = await deps.disputes.escalate(d.id, 'review', nextLvlDeadline);
      if (updated) {
        await deps.log.append({
          action: 'escalated',
          level: 'review',
          rationale: 'Anchor did not respond within 72 hours.',
          disputeRef: publicDisputeRef(d.id),
          anchorId: d.anchorId,
          category: d.category,
          decidedAt: nowIso,
        });
        escalated++;
      }
    }
  }

  return { scanned: disputes.length, escalated };
}
