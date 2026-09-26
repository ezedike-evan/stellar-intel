import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import { AppendOutcomeInputSchema, toOutcomeLogRow } from '@/lib/reputation/schema';
import { verifyIntentSignature } from '@/lib/intent/verify';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';

// ─── POST /api/reputation/append (Issue #129 / #220) ───────────────────────────
//
// The single server-side write path for outcome rows. The client never writes
// to the store directly — it POSTs here when an intent reaches a terminal state.
//
// Accepted rows feed anchor scores and, through the publisher, the on-chain
// oracle, so the route is strict:
//
// - 401 when `publicKey` or `signature` is missing.
// - 400 when the body fails `AppendOutcomeInputSchema` (unknown anchor, a
//   corridor that anchor does not serve, out-of-range numbers, bad hashes).
// - 401 when `signature` is not a valid Ed25519 signature by `publicKey` over
//   `intentHash`. Unsigned rows are no longer accepted as telemetry.
// - 409 when a row for `intentHash` already exists. Appends are insert-only:
//   the stored row is never rewritten, even by a byte-identical retry, so a
//   repeat POST cannot change an outcome or reset its reconcile/publish state.
// - 201 with `attested: true` otherwise; the row stores `publicKey` as its signer.

function hasAttestationFields(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const { publicKey, signature } = body as Record<string, unknown>;
  return (
    typeof publicKey === 'string' &&
    publicKey.length > 0 &&
    typeof signature === 'string' &&
    signature.length > 0
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.append', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.append',
      maxRequests: 20,
    });
    if (limited) return limited;

    const body: unknown = await request.json().catch(() => null);

    // An unsigned write is an authentication failure, not a malformed body, so
    // it gets 401 before the schema runs (which would otherwise report a 400).
    if (!hasAttestationFields(body)) {
      logger.warn({ event: 'append_unsigned' });
      return NextResponse.json<ApiError>(
        { code: 'UNAUTHORIZED', message: 'publicKey and signature are required' },
        { status: 401 }
      );
    }

    const parsed = AppendOutcomeInputSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ event: 'append_validation_failed' });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid outcome' },
        { status: 400 }
      );
    }

    const { intentHash, publicKey, signature } = parsed.data;
    if (!verifyIntentSignature({ intentHash, publicKey, signature })) {
      logger.warn({ event: 'append_attestation_failed', publicKey });
      return NextResponse.json<ApiError>(
        { code: 'UNAUTHORIZED', message: 'Signature verification failed' },
        { status: 401 }
      );
    }

    const row = toOutcomeLogRow(parsed.data);
    const inserted = await getReputationStore().append(row);
    if (!inserted) {
      logger.warn({ event: 'append_duplicate', intentHash });
      return NextResponse.json<ApiError>(
        { code: 'CONFLICT', message: 'An outcome for this intentHash was already recorded' },
        { status: 409 }
      );
    }

    logger.info({
      event: 'outcome_appended',
      anchorId: row.anchorId,
      outcome: row.outcome,
      attested: true,
    });
    return NextResponse.json(
      { ok: true, intentHash: row.intentHash, attested: true },
      { status: 201 }
    );
  });
}
