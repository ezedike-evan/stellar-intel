import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { isFlag } from '@/lib/flags';
import { enforceRateLimit } from '@/lib/api/response';
import { verifyStandingAuthorization } from '@/lib/recurring/authorization';
import {
  getStandingAuthorizationStore,
  type StandingAuthorizationRecord,
} from '@/lib/recurring/authorization-store';
import { computeAuthorizationState } from '@/lib/recurring/due';
import type { ApiError } from '@/types';

export const runtime = 'nodejs';

// ─── POST /api/recurring ──────────────────────────────────────────────────────
//
// Stores a signed standing authorization (REC007). The id is a random UUID that
// only the creator learns, so it doubles as the read capability for GET
// /api/recurring/{id}. Behind NEXT_PUBLIC_RECURRING_INTENTS: with the flag off the
// route answers like one that does not exist.

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isFlag('recurringIntents')) {
    return NextResponse.json<ApiError>(
      { code: 'NOT_FOUND', message: 'Not found' },
      { status: 404 }
    );
  }

  return withRequestLogger(request, 'api.recurring.create', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.recurring.create',
      maxRequests: 10,
    });
    if (limited) return limited;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<ApiError>(
        { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const verified = await verifyStandingAuthorization(body);
    if (!verified.ok) {
      logger.warn({ event: 'standing_authorization_rejected', code: verified.code });
      if (verified.code === 'invalid_payload') {
        return NextResponse.json<ApiError>(
          { code: 'VALIDATION_ERROR', message: verified.message },
          { status: 400 }
        );
      }
      if (verified.code === 'hash_mismatch' || verified.code === 'invalid_signature') {
        return NextResponse.json<ApiError>(
          { code: 'UNAUTHORIZED', message: verified.message },
          { status: 401 }
        );
      }
      return NextResponse.json<ApiError>(
        { code: verified.code.toUpperCase(), message: verified.message },
        { status: 422 }
      );
    }

    const { authorization } = verified;
    const now = new Date();
    const record: StandingAuthorizationRecord = {
      id: randomUUID(),
      termsHash: authorization.termsHash,
      authorization,
      status: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const created = await getStandingAuthorizationStore().create(record);
    if (!created.ok) {
      return NextResponse.json<ApiError>(
        {
          code: 'DUPLICATE_AUTHORIZATION',
          message: 'This standing authorization has already been submitted',
        },
        { status: 409 }
      );
    }

    // Never log the sender: only the id, corridor and period.
    logger.info({
      event: 'standing_authorization_created',
      id: record.id,
      corridorId: authorization.terms.corridorId,
      period: authorization.terms.period,
    });

    const state = computeAuthorizationState(record, [], now);
    return NextResponse.json(
      { id: record.id, termsHash: record.termsHash, state },
      { status: 201 }
    );
  });
}
