import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import type { ApiError } from '@/types';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';
import { _setDisputeStore, getDisputeStore } from '@/lib/reputation/disputes';
import { verifyIntentSignature } from '@/lib/intent/verify';
import { enforceRateLimit } from '@/lib/api/response';
import { ANCHORS } from '@/constants/anchors';

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
});

export type DisputeBody = z.infer<typeof DisputeBodySchema>;

export interface DisputeRecord {
  id: string;
  intentHash: string;
  publicKey: string;
  anchorId: string;
  reason: string;
  disputed: true;
  createdAt: string;
}

const DISPUTE_WINDOW_MS = 86_400_000; // 24 hours
const DISPUTE_MAX = 10;

/**
 * Per-signer dispute quota, now counted through the shared limiter instead of a
 * private Map — the private one was per-instance, so the "10 per 24 h" cap was
 * really 10 per instance per 24 h (#733 / #911).
 *
 * Keyed by publicKey rather than IP on purpose: the quota belongs to the signer,
 * and rotating IPs should not buy more disputes.
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
  clearRateLimitStore();
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.dispute', async (logger) => {
    // The per-signer quota below is free to dodge with freshly generated keys, so
    // there is also a per-IP limit, checked before anything is parsed.
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

    const { intentHash, publicKey, signature, anchorId, reason } = parsed.data;

    logger.info({ event: 'dispute_submission', anchorId, publicKey, intentHash });

    // Verify Ed25519 proof: signature over the raw intentHash bytes.
    const valid = verifyIntentSignature({ intentHash, publicKey, signature });

    if (!valid) {
      logger.warn({ event: 'signature_verification_failed', publicKey, intentHash });
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Signature verification failed' },
        { status: 403 }
      );
    }

    if (!(await checkDisputeRateLimit(publicKey))) {
      logger.warn({ event: 'rate_limited', publicKey });
      return NextResponse.json<ApiError>(
        { code: 'RATE_LIMITED', message: 'Dispute limit of 10 per 24 h exceeded' },
        { status: 429 }
      );
    }

    const record: DisputeRecord = {
      id: `${publicKey.slice(0, 8)}-${intentHash.slice(0, 8)}-${Date.now()}`,
      intentHash,
      publicKey,
      anchorId,
      reason,
      disputed: true,
      createdAt: new Date().toISOString(),
    };
    await getDisputeStore().create({
      id: record.id,
      intentHash,
      publicKey,
      anchorId,
      reason,
      status: 'open',
      createdAt: record.createdAt,
      resolvedAt: null,
    });

    logger.info({ event: 'dispute_created', disputeId: record.id });
    return NextResponse.json(record, { status: 201 });
  });
}
