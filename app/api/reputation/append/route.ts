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
// to the store directly — it POSTs here when an intent reaches a terminal state,
// and the row is validated against the #218 schema before being persisted.

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.append', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.append',
      maxRequests: 20,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = AppendOutcomeInputSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ event: 'append_validation_failed' });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid outcome' },
        { status: 400 }
      );
    }

    // Optional attestation. Both fields must be supplied together; when present
    // the signature is verified over intentHash and a bad one is rejected — so a
    // forged, signed row cannot get in. An unsigned row is still accepted as
    // telemetry (attested=false). Gating the on-chain publish path on `attested`
    // is a deliberate follow-up: it must wait until clients actually attest, or
    // the score feed would go empty overnight.
    const { signature, publicKey } = parsed.data;
    if ((signature === undefined) !== (publicKey === undefined)) {
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'signature and publicKey must be provided together' },
        { status: 400 }
      );
    }

    let attested = false;
    if (signature !== undefined && publicKey !== undefined) {
      attested = verifyIntentSignature({
        intentHash: parsed.data.intentHash,
        publicKey,
        signature,
      });
      if (!attested) {
        logger.warn({ event: 'append_attestation_failed', publicKey });
        return NextResponse.json<ApiError>(
          { code: 'FORBIDDEN', message: 'Signature verification failed' },
          { status: 403 }
        );
      }
    }

    const row = toOutcomeLogRow(parsed.data);
    await getReputationStore().append(row);

    logger.info({
      event: 'outcome_appended',
      anchorId: row.anchorId,
      outcome: row.outcome,
      attested,
    });
    return NextResponse.json({ ok: true, intentHash: row.intentHash, attested }, { status: 201 });
  });
}
