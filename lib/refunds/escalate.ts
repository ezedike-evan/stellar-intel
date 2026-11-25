import crypto from 'node:crypto';
import type { RefundStore } from './store';
import { REFUND_OWED_OVERDUE_MS } from './store';
import type { DisputeStore } from '@/lib/reputation/disputes';
import type { AdjudicationLogStore } from '@/lib/reputation/adjudication-log';
import { publicDisputeRef } from '@/lib/reputation/adjudication-log';
import { levelDeadline } from '@/lib/reputation/dispute-ladder';

export async function openDisputesForOverdueRefunds(deps: {
  refunds: RefundStore;
  disputes: DisputeStore;
  log: AdjudicationLogStore;
  now?: Date;
}): Promise<{ scanned: number; opened: number }> {
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const owedCases = await deps.refunds.list({ status: 'owed' });

  let opened = 0;
  for (const c of owedCases) {
    const openedMs = new Date(c.openedAt).getTime();
    if (now.getTime() - openedMs > REFUND_OWED_OVERDUE_MS) {
      const existing = await deps.disputes.findBySubject('refund', c.id);
      if (existing.length === 0) {
        const id = crypto.randomUUID();
        await deps.disputes.create({
          id,
          intentHash: c.intentHash,
          publicKey: c.signerAccount,
          anchorId: c.anchorId,
          reason: 'Refund owed for more than 7 days (opened automatically)',
          category: 'refund_missing',
          level: 'anchor',
          levelDeadline: levelDeadline('anchor', nowIso),
          subjectKind: 'refund',
          subjectRef: c.id,
          status: 'open',
          createdAt: nowIso,
          resolvedAt: null,
          appealedAt: null,
        });

        await deps.log.append({
          action: 'filed',
          level: 'anchor',
          category: 'refund_missing',
          anchorId: c.anchorId,
          disputeRef: publicDisputeRef(id),
          rationale: 'Opened automatically: refund overdue.',
          decidedAt: nowIso,
        });

        opened++;
      }
    }
  }

  return { scanned: owedCases.length, opened };
}
