import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminRequest } from '@/lib/auth/admin';
import { withRequestLogger } from '@/lib/logger';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';
import { getDisputeStore } from '@/lib/reputation/disputes';

const ResolveBodySchema = z.object({
  id: z.string().min(1).max(200),
  action: z.enum(['accept', 'reject']),
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
        { code: 'VALIDATION_ERROR', message: 'id and action (accept|reject) are required' },
        { status: 400 }
      );
    }
    const { id, action } = parsed.data;

    const dispute = await getDisputeStore().resolve(
      id,
      action === 'accept' ? 'accepted' : 'rejected',
      new Date().toISOString()
    );
    if (!dispute) {
      logger.warn({ event: 'dispute_not_found', disputeId: id });
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: 'Dispute not found' },
        { status: 404 }
      );
    }

    logger.info({ event: 'dispute_resolved', disputeId: id, action });
    return NextResponse.json(dispute);
  });
}
