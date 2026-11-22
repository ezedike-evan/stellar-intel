import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminRequest } from '@/lib/auth/admin';
import { withRequestLogger } from '@/lib/logger';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';
import { getDisputeStore } from '@/lib/reputation/disputes';
import { getReputationStore } from '@/lib/reputation/store';
import {
  getAdjudicationLog,
  publicDisputeRef,
  assertPublicSafe,
  PublicTextError,
} from '@/lib/reputation/adjudication-log';
import { nextLevel, levelDeadline } from '@/lib/reputation/dispute-ladder';

const ResolveBodySchema = z.object({
  id: z.string().min(1).max(200),
  action: z.enum(['accept', 'reject', 'escalate']),
  rationale: z.string().max(500).default(''),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.disputes', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.admin.disputes',
      maxRequests: 60,
    });
    if (limited) return limited;

    if (!isAdminRequest(request)) {
      logger.warn({ event: 'unauthorized_access', path: request.nextUrl.pathname });
      return NextResponse.json<ApiError>(
        { code: 'UNAUTHORIZED', message: 'Admin access required' },
        { status: 401 }
      );
    }

    // Newest first, per the store's contract.
    const disputes = await getDisputeStore().list();

    logger.info({ event: 'admin_disputes_listed', count: disputes.length });
    return NextResponse.json(disputes);
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.disputes', async (logger) => {
    if (!isAdminRequest(request)) {
      logger.warn({ event: 'unauthorized_access', path: request.nextUrl.pathname });
      return NextResponse.json<ApiError>(
        { code: 'UNAUTHORIZED', message: 'Admin access required' },
        { status: 401 }
      );
    }

    const limited = await enforceRateLimit(request, {
      bucket: 'api.admin.disputes.resolve',
      maxRequests: 30,
    });
    if (limited) return limited;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      logger.warn({ event: 'invalid_json', message: 'Request body must be valid JSON' });
      return NextResponse.json<ApiError>(
        { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const parsed = ResolveBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ event: 'validation_failed', issues: parsed.error.issues.length });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'id and action (accept|reject|escalate) are required' },
        { status: 400 }
      );
    }
    const { id, action, rationale } = parsed.data;

    try {
      assertPublicSafe(rationale);
    } catch (err: unknown) {
      const msg = err instanceof PublicTextError ? err.message : 'Rationale is not public safe';
      return NextResponse.json<ApiError>(
        { code: 'RATIONALE_NOT_PUBLIC_SAFE', message: msg },
        { status: 400 }
      );
    }

    const store = getDisputeStore();
    const dispute = await store.get(id);
    if (!dispute) {
      logger.warn({ event: 'dispute_not_found', disputeId: id });
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: 'Dispute not found' },
        { status: 404 }
      );
    }

    if (dispute.status !== 'open') {
      logger.warn({ event: 'dispute_already_resolved', disputeId: id, status: dispute.status });
      return NextResponse.json<ApiError>(
        { code: 'CONFLICT', message: `Dispute is already ${dispute.status}` },
        { status: 409 }
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();

    if (action === 'escalate') {
      const next = nextLevel(dispute.level);
      if (next === null || next === 'appeal') {
        return NextResponse.json<ApiError>(
          { code: 'CANNOT_ESCALATE', message: 'Cannot escalate past review' },
          { status: 409 }
        );
      }

      const nextDeadline = levelDeadline(next, nowIso);
      const updated = await store.escalate(id, next, nextDeadline);
      if (!updated) {
        return NextResponse.json<ApiError>(
          { code: 'INTERNAL_ERROR', message: 'Failed to escalate dispute' },
          { status: 500 }
        );
      }

      try {
        await getAdjudicationLog().append({
          action: 'escalated',
          level: next,
          rationale,
          disputeRef: publicDisputeRef(id),
          anchorId: dispute.anchorId,
          category: dispute.category,
          decidedAt: nowIso,
        });
      } catch (err: unknown) {
        logger.error({ event: 'adjudication_log_append_failed', error: err });
        return NextResponse.json<ApiError>(
          { code: 'INTERNAL_ERROR', message: 'Failed to record adjudication log' },
          { status: 500 }
        );
      }

      logger.info({ event: 'dispute_escalated', disputeId: id, level: next });
      return NextResponse.json(updated);
    }

    // Action is accept or reject
    const nextStatus = action === 'accept' ? 'accepted' : 'rejected';
    const updated = await store.resolve(id, nextStatus, nowIso);
    if (!updated) {
      return NextResponse.json<ApiError>(
        { code: 'INTERNAL_ERROR', message: 'Failed to resolve dispute' },
        { status: 500 }
      );
    }

    try {
      await getAdjudicationLog().append({
        action: nextStatus,
        level: dispute.level,
        rationale,
        disputeRef: publicDisputeRef(id),
        anchorId: dispute.anchorId,
        category: dispute.category,
        decidedAt: nowIso,
      });
    } catch (err: unknown) {
      logger.error({ event: 'adjudication_log_append_failed', error: err });
      return NextResponse.json<ApiError>(
        { code: 'INTERNAL_ERROR', message: 'Failed to record adjudication log' },
        { status: 500 }
      );
    }

    if (action === 'accept' && dispute.subjectKind === 'outcome') {
      try {
        await getReputationStore().markDisputed(dispute.intentHash, {
          disputed: true,
          disputedReason: `dispute ${publicDisputeRef(dispute.id)} accepted (${dispute.category})`,
        });
      } catch (err: unknown) {
        logger.error({ event: 'mark_disputed_failed', error: err, intentHash: dispute.intentHash });
        return NextResponse.json<ApiError>(
          { code: 'INTERNAL_ERROR', message: 'Failed to update reputation outcome' },
          { status: 500 }
        );
      }
    }

    logger.info({ event: 'dispute_resolved', disputeId: id, action });
    return NextResponse.json(updated);
  });
}
