import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { isFlag } from '@/lib/flags';
import { enforceRateLimit } from '@/lib/api/response';
import { getStandingAuthorizationStore } from '@/lib/recurring/authorization-store';
import { computeAuthorizationState, type DueReminder } from '@/lib/recurring/due';
import type { ApiError } from '@/types';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 20;

// ─── GET /api/recurring/due?ids=<uuid>,<uuid> ─────────────────────────────────
//
// Returns the reminders that are due now for the given authorization ids
// (REC007). The caller supplies ids it already holds; unknown ids are skipped
// silently, so the endpoint cannot be used to enumerate authorizations.

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isFlag('recurringIntents')) {
    return NextResponse.json<ApiError>(
      { code: 'NOT_FOUND', message: 'Not found' },
      { status: 404 }
    );
  }

  return withRequestLogger(request, 'api.recurring.due', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.recurring.due',
      maxRequests: 60,
    });
    if (limited) return limited;

    const raw = request.nextUrl.searchParams.get('ids');
    if (!raw) {
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'ids is required' },
        { status: 400 }
      );
    }

    const ids = raw.split(',');
    if (ids.length > MAX_IDS) {
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: `ids must list at most ${MAX_IDS} entries` },
        { status: 400 }
      );
    }
    if (!ids.every((id) => UUID_PATTERN.test(id))) {
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'every id must be a UUID' },
        { status: 400 }
      );
    }

    const store = getStandingAuthorizationStore();
    const now = new Date();
    const reminders: DueReminder[] = [];
    for (const id of new Set(ids)) {
      const record = await store.get(id);
      if (!record) continue;
      const executions = await store.listExecutions(id);
      const state = computeAuthorizationState(record, executions, now);
      if (state.phase === 'due' && state.due) reminders.push(state.due);
    }

    logger.info({
      event: 'standing_reminders_listed',
      requested: ids.length,
      due: reminders.length,
    });
    return NextResponse.json({ reminders });
  });
}
