import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import type { ApiError } from '@/types';
import { getDisputeStore } from '@/lib/reputation/disputes';
import { verifyIntentSignature } from '@/lib/intent/verify';
import { enforceRateLimit } from '@/lib/api/response';
import {
  APPEAL_WINDOW_MS,
  levelDeadline,
} from '@/lib/reputation/dispute-ladder';
import {
  getAdjudicationLog,
  publicDisputeRef,
} from '@/lib/reputation/adjudication-log';

const AppealBodySchema = z
  .object({
    intentHash: z.string().regex(/^[0-9a-f]{64}$/, {
      message: 'intentHash must be a lowercase hex-encoded SHA-256 (64 chars)',
    }),
    publicKey: z.string().regex(STELLAR_PUBKEY_PATTERN, {
      message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
    }),
    signature: z.string().min(1, { message: 'signature is required' }).max(512),
    ref: z.string().regex(/^[0-9a-f]{16}$/, {
      message: 'ref must be a 16-character hex dispute reference',
    }),
  })
  .strict();

export type AppealBody = z.infer<typeof AppealBodySchema>;

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.dispute.appeal', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.dispute.appeal',
      maxRequests: 10,
    });
    if (limited) return limited;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json<ApiError>(
        { code: 'BAD_REQUEST', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const parsed = AppealBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid request body',
        },
        { status: 422 }
      );
    }

    const { intentHash, publicKey, signature, ref } = parsed.data;

    // Verify Ed25519 signature
    if (!verifyIntentSignature({ intentHash, publicKey, signature })) {
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Invalid signature for intentHash and publicKey' },
        { status: 403 }
      );
    }

    const disputes = await getDisputeStore().findByIntentHash(intentHash);
    const dispute = disputes.find((d) => publicDisputeRef(d.id) === ref);
    if (!dispute) {
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: 'No dispute found for this intent and reference' },
        { status: 404 }
      );
    }

    if (dispute.publicKey !== publicKey) {
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Only the account that filed the dispute can appeal it' },
        { status: 403 }
      );
    }

    if (dispute.status !== 'accepted' && dispute.status !== 'rejected') {
      return NextResponse.json<ApiError>(
        { code: 'NOT_RESOLVED', message: 'Dispute is not yet resolved' },
        { status: 409 }
      );
    }

    if (dispute.appealedAt !== null) {
      return NextResponse.json<ApiError>(
        { code: 'ALREADY_APPEALED', message: 'Dispute has already been appealed' },
        { status: 409 }
      );
    }

    const resolvedAtMs = dispute.resolvedAt ? new Date(dispute.resolvedAt).getTime() : 0;
    const now = Date.now();
    if (now - resolvedAtMs > APPEAL_WINDOW_MS) {
      return NextResponse.json<ApiError>(
        { code: 'APPEAL_WINDOW_CLOSED', message: 'Appeal window has closed (14 days)' },
        { status: 410 }
      );
    }

    const nowIso = new Date(now).toISOString();
    const deadline = levelDeadline('appeal', nowIso);
    const updated = await getDisputeStore().openAppeal(dispute.id, nowIso, deadline);
    if (!updated) {
      return NextResponse.json<ApiError>(
        { code: 'CONFLICT', message: 'Could not open appeal' },
        { status: 409 }
      );
    }

    try {
      await getAdjudicationLog().append({
        action: 'appealed',
        level: 'appeal',
        rationale: '',
        disputeRef: ref,
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

    logger.info({ event: 'dispute_appealed', ref });

    return NextResponse.json(
      {
        ref,
        level: 'appeal',
        levelDeadline: deadline,
      },
      { status: 200 }
    );
  });
}
