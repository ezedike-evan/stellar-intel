import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import type { ApiError } from '@/types';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';
import { _setDisputeStore, getDisputeStore } from '@/lib/reputation/disputes';
import { verifyIntentSignature } from '@/lib/intent/verify';
import { enforceRateLimit } from '@/lib/api/response';
import { checkDurableStore } from '@/lib/api/store-guard';
import { getReputationStore } from '@/lib/reputation/store';
import { ANCHORS } from '@/constants/anchors';
import {
  DISPUTE_CATEGORIES,
  levelDeadline,
  type DisputeCategory,
  type DisputeLevel,
} from '@/lib/reputation/dispute-ladder';
import {
  getAdjudicationLog,
  publicDisputeRef,
  _setAdjudicationLog,
} from '@/lib/reputation/adjudication-log';

const DisputeBodySchema = z.object({
  intentHash: z.string().regex(/^[0-9a-f]{64}$/, {
    message: 'intentHash must be a lowercase hex-encoded SHA-256 (64 chars)',
  }),
  publicKey: z.string().regex(STELLAR_PUBKEY_PATTERN, {
    message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
  }),
  signature: z.string().min(1, { message: 'signature is required' }),
  anchorId: z
    .string()
    .min(1, { message: 'anchorId is required' })
    .max(64)
    .refine((id) => ANCHORS.some((a) => a.id === id), 'Unknown anchorId'),
  reason: z
    .string()
    .min(1, { message: 'reason is required' })
    .max(1000, { message: 'reason must be at most 1000 characters' }),
  category: z.enum(DISPUTE_CATEGORIES).default('other'),
});

export type DisputeBody = z.infer<typeof DisputeBodySchema>;

export interface DisputeRecord {
  id: string;
  ref: string;
  intentHash: string;
  publicKey: string;
  anchorId: string;
  reason: string;
  category: DisputeCategory;
  level: DisputeLevel;
  levelDeadline: string;
  disputed: true;
  createdAt: string;
}

const DISPUTE_WINDOW_MS = 86_400_000; // 24 hours
const DISPUTE_MAX = 10;

/**
 * Per-signer dispute quota, now counted through the shared limiter instead of a
 * private Map.
 */
async function checkDisputeRateLimit(publicKey: string): Promise<boolean> {
  const result = await checkRateLimit(publicKey, {
    bucket: 'api.reputation.dispute',
    maxRequests: DISPUTE_MAX,
    windowMs: DISPUTE_WINDOW_MS,
  });
  return result.allowed;
}

export function clearDisputeStores(): void {
  _setDisputeStore(null);
  _setAdjudicationLog(null);
  clearRateLimitStore();
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.dispute', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.dispute.ip',
      maxRequests: 10,
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

    const parsed = DisputeBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ event: 'validation_failed', issues: parsed.error.issues });
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Validation failed',
        },
        { status: 422 }
      );
    }

    const { intentHash, publicKey, signature, anchorId, reason, category } = parsed.data;

    logger.info({ event: 'dispute_submission', anchorId, publicKey, intentHash, category });

    // Verify Ed25519 proof: signature over the raw intentHash bytes.
    const valid = verifyIntentSignature({ intentHash, publicKey, signature });

    if (!valid) {
      logger.warn({ event: 'signature_verification_failed', publicKey, intentHash });
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Signature verification failed' },
        { status: 403 }
      );
    }

    // Only the account that attested the outcome may dispute it.
    const unavailable = checkDurableStore();
    if (unavailable) return unavailable;

    const [outcome] = await getReputationStore().query({ intentHash, includeUnattested: true });
    if (!outcome) {
      logger.warn({ event: 'dispute_unknown_outcome', intentHash });
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: 'No outcome recorded for this intentHash' },
        { status: 404 }
      );
    }
    if (outcome.signerAccount !== publicKey) {
      logger.warn({ event: 'dispute_signer_mismatch', publicKey, intentHash });
      return NextResponse.json<ApiError>(
        {
          code: 'FORBIDDEN',
          message: 'Only the account that attested the outcome can dispute it',
        },
        { status: 403 }
      );
    }

    // Check if an open dispute already exists on this intent
    const existingDisputes = await getDisputeStore().findByIntentHash(intentHash);
    if (existingDisputes.some((d) => d.status === 'open')) {
      logger.warn({ event: 'dispute_already_open', intentHash });
      return NextResponse.json<ApiError>(
        {
          code: 'CONFLICT',
          message: 'An open dispute already exists for this intent',
        },
        { status: 409 }
      );
    }

    if (!(await checkDisputeRateLimit(publicKey))) {
      logger.warn({ event: 'rate_limited', publicKey });
      return NextResponse.json<ApiError>(
        { code: 'RATE_LIMITED', message: 'Dispute limit of 10 per 24 h exceeded' },
        { status: 429 }
      );
    }

    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const level: DisputeLevel = 'anchor';
    const deadline = levelDeadline(level, createdAt);
    const ref = publicDisputeRef(id);

    const record: DisputeRecord = {
      id,
      ref,
      intentHash,
      publicKey,
      anchorId,
      reason,
      category,
      level,
      levelDeadline: deadline,
      disputed: true,
      createdAt,
    };

    await getDisputeStore().create({
      id,
      intentHash,
      publicKey,
      anchorId,
      reason,
      status: 'open',
      createdAt,
      resolvedAt: null,
      category,
      level,
      levelDeadline: deadline,
      subjectKind: 'outcome',
      subjectRef: intentHash,
      appealedAt: null,
    });

    try {
      await getAdjudicationLog().append({
        action: 'filed',
        level: 'anchor',
        rationale: '',
        disputeRef: ref,
        anchorId,
        category,
        decidedAt: createdAt,
      });
    } catch (err: unknown) {
      logger.error({ event: 'adjudication_log_append_failed', error: err });
      return NextResponse.json<ApiError>(
        { code: 'INTERNAL_ERROR', message: 'Failed to record adjudication log' },
        { status: 500 }
      );
    }

    logger.info({ event: 'dispute_created', disputeId: record.id, ref });
    return NextResponse.json(record, { status: 201 });
  });
}
