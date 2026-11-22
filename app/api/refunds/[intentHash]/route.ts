import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { enforceRateLimit } from '@/lib/api/response';
import { getRefundStore, toPublicRefundCase } from '@/lib/refunds/store';
import type { ApiError } from '@/types';

export const runtime = 'nodejs';

const INTENT_HASH_REGEX = /^[0-9a-f]{64}$/;

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

    if (!intentHash || !INTENT_HASH_REGEX.test(intentHash)) {
      logger.warn({ event: 'refund_lookup_invalid_hash', intentHash });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'intentHash must be 64 lowercase hex characters' },
        { status: 400 }
      );
    }

    const store = getRefundStore();
    const cases = await store.getByIntentHash(intentHash);

    return NextResponse.json(
      {
        intentHash,
        cases: cases.map(toPublicRefundCase),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  });
}
