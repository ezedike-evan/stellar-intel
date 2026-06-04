import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import { AppendOutcomeInputSchema, toOutcomeLogRow } from '@/lib/reputation/schema';
import type { ApiError } from '@/types';

export const runtime = 'nodejs';

// ─── POST /api/reputation/append (Issue #129 / #220) ───────────────────────────
//
// The single server-side write path for outcome rows. The client never writes
// to the store directly — it POSTs here when an intent reaches a terminal state,
// and the row is validated against the #218 schema before being persisted.

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.append', async (logger) => {
    const body = await request.json().catch(() => null);
    const parsed = AppendOutcomeInputSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ event: 'append_validation_failed' });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid outcome' },
        { status: 400 }
      );
    }

    const row = toOutcomeLogRow(parsed.data);
    await getReputationStore().append(row);

    logger.info({ event: 'outcome_appended', anchorId: row.anchorId, outcome: row.outcome });
    return NextResponse.json({ ok: true, intentHash: row.intentHash }, { status: 201 });
  });
}
