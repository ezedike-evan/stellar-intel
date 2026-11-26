import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { isFlag } from '@/lib/flags';
import { enforceRateLimit } from '@/lib/api/response';
import { getStandingAuthorizationStore } from '@/lib/recurring/authorization-store';
import { computeAuthorizationState } from '@/lib/recurring/due';
import type { ApiError } from '@/types';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): NextResponse {
  return NextResponse.json<ApiError>({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
}

// ─── GET /api/recurring/[id] ──────────────────────────────────────────────────
//
// Reads one standing authorization back with its computed state and execution
// history (REC007). The UUID is the read capability. The signature is never
// returned.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isFlag('recurringIntents')) return notFound();

  return withRequestLogger(request, 'api.recurring.read', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.recurring.read',
      maxRequests: 60,
    });
    if (limited) return limited;

    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return notFound();

    const store = getStandingAuthorizationStore();
    const record = await store.get(id);
    if (!record) return notFound();

    const executions = await store.listExecutions(id);
    const state = computeAuthorizationState(record, executions, new Date());

    logger.info({
      event: 'standing_authorization_read',
      id: record.id,
      corridorId: record.authorization.terms.corridorId,
      period: record.authorization.terms.period,
    });

    return NextResponse.json({
      id: record.id,
      termsHash: record.termsHash,
      terms: record.authorization.terms,
      status: record.status,
      state,
      executions,
    });
  });
}
