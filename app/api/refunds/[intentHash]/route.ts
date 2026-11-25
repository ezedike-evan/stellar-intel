import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { enforceRateLimit } from '@/lib/api/response';
import { getRefundStore, toPublicRefundCase } from '@/lib/refunds/store';
import type { ApiError } from '@/types';

export const runtime = 'nodejs';

const INTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

const NO_STORE = { 'Cache-Control': 'no-store' };

// ─── GET /api/refunds/[intentHash] ─────────────────────────────────────────────
//
// Read-only lookup of the refund cases tracked for one intent. Only the public
// view of a case is returned (see `toPublicRefundCase`); the signer account and
// the acknowledgement proof never leave the store. There is deliberately no
// listing by account, because that would link a wallet to its refunds publicly.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ intentHash: string }> | { intentHash: string } }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.refunds.lookup', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.refunds.lookup',
      maxRequests: 60,
    });
    if (limited) return limited;

    const { intentHash } = await params;

    if (!INTENT_HASH_PATTERN.test(intentHash)) {
      logger.warn({ event: 'invalid_intent_hash' });
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: 'intentHash must be a lowercase hex-encoded SHA-256 (64 chars)',
        },
        { status: 400, headers: NO_STORE }
      );
    }

    // Oldest first, per the store's contract. An intent with no cases is a normal
    // answer, not a 404: the caller is asking whether anything is tracked.
    const cases = await getRefundStore().getByIntentHash(intentHash);
    logger.info({ event: 'refund_lookup', caseCount: cases.length });

    const body = { intentHash, cases: cases.map(toPublicRefundCase) };
    return NextResponse.json(body, { headers: NO_STORE });
  });
}
