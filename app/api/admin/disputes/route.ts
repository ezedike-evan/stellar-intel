import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/auth/admin';
import { withRequestLogger } from '@/lib/logger';
import type { ApiError } from '@/types';

export type DisputeStatus = 'pending' | 'accepted' | 'rejected';

export interface Dispute {
  id: string;
  submittedBy: string;
  anchorId: string;
  reason: string;
  status: DisputeStatus;
  createdAt: string;
  resolvedAt: string | null;
}

// In-memory store — replace with a database client for production persistence.
const store = new Map<string, Dispute>();

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.disputes', async (logger) => {
    if (!isAdminRequest(request)) {
      logger.warn({ event: 'unauthorized_access', path: request.nextUrl.pathname })
      return NextResponse.json<ApiError>(
        { code: 'UNAUTHORIZED', message: 'Admin access required' },
        { status: 401 }
      )
    }

    const disputes = Array.from(store.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    logger.info({ event: 'admin_disputes_listed', count: disputes.length })
    return NextResponse.json(disputes)
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.disputes', async (logger) => {
    if (!isAdminRequest(request)) {
      logger.warn({ event: 'unauthorized_access', path: request.nextUrl.pathname })
      return NextResponse.json<ApiError>(
        { code: 'UNAUTHORIZED', message: 'Admin access required' },
        { status: 401 }
      )
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      logger.warn({ event: 'invalid_json', message: 'Request body must be valid JSON' });
      return NextResponse.json<ApiError>(
        { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }

    const { id, action } = body as { id?: string; action?: string };

    if (!id || !['accept', 'reject'].includes(action ?? '')) {
      logger.warn({ event: 'validation_failed', hasId: Boolean(id), action })
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'id and action (accept|reject) are required' },
        { status: 400 }
      )
    }

    const dispute = store.get(id);
    if (!dispute) {
      logger.warn({ event: 'dispute_not_found', disputeId: id })
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: 'Dispute not found' },
        { status: 404 }
      )
    }

    dispute.status = action === 'accept' ? 'accepted' : 'rejected';
    dispute.resolvedAt = new Date().toISOString();
    store.set(id, dispute);

    logger.info({ event: 'dispute_resolved', disputeId: id, action })
    return NextResponse.json(dispute)
  })
}
