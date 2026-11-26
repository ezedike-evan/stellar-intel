import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import {
  AppendOutcomeInputSchema,
  outcomeIntentMatchesHash,
  toOutcomeLogRow,
} from '@/lib/reputation/schema';
import { detectSlippageBreach } from '@/lib/reputation/slippage-detect';
import { verifyIntentSignature } from '@/lib/intent/verify';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';
import { requireCallerScope } from '@/lib/auth/caller';
import { emitWebhookEvent } from '@/lib/webhooks/emit';
import {
  emitRefundOpened,
  openRefundCaseForBreach,
  openRefundCaseForOutcome,
} from '@/lib/refunds/detect';
import type { RefundCase } from '@/lib/refunds/store';
import type { OutcomeLogRow, SlippageBreach } from '@/types/reputation';

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
//
// Webhooks fire only on the 201 path. Payloads are built field by field from
// the stored row, never spread, so `signerAccount` and `signature` cannot leak.

/**
 * Tells subscribers a breach was detected, so they need not poll for it. The payload
 * is built field by field: the record's `signerAccount`, `evidence` and
 * `anchorTransactionId` never leave the platform. `status` is the literal the record
 * was just written with, not a later verification result.
 *
 * The idempotency key is made from the intent hash: there is one breach per intent,
 * so however often this is emitted for it, a subscriber sees one event.
 */
function emitSlippageBreachEvent(breach: SlippageBreach): void {
  emitWebhookEvent(
    'intent.slippage_breach',
    {
      intentHash: breach.intentHash,
      anchorId: breach.anchorId,
      corridor: breach.corridor,
      minReceive: breach.minReceive,
      amountOut: breach.amountOut,
      shortfall: breach.shortfall,
      shortfallBps: breach.shortfallBps,
      evidenceHash: breach.evidenceHash,
      status: 'detected',
      detectedAt: breach.detectedAt,
    },
    { idempotencyKey: `intent.slippage_breach:${breach.intentHash}` }
  );
}

function emitOutcomeEvents(row: OutcomeLogRow): void {
  const { intentHash, anchorId, corridor, outcome } = row;

  // Each key below is the kind and the intent hash. The log holds one row per intent
  // hash and never rewrites it, so an event about that row is the same event however
  // often it is emitted, and a subscriber processes it once.
  emitWebhookEvent(
    'reputation.event_written',
    {
      intentHash,
      anchorId,
      corridor,
      outcome,
      createdAt: row.createdAt,
    },
    { idempotencyKey: `reputation.event_written:${intentHash}` }
  );

  switch (outcome) {
    case 'completed':
      emitWebhookEvent(
        'intent.settled',
        {
          intentHash,
          anchorId,
          corridor,
          quotedAmount: row.quotedAmount,
          stellarTransactionId: row.stellarTransactionId,
        },
        { idempotencyKey: `intent.settled:${intentHash}` }
      );
      break;
    case 'error':
    case 'expired':
    case 'refunded':
      emitWebhookEvent(
        'intent.failed',
        { intentHash, anchorId, corridor, outcome },
        { idempotencyKey: `intent.failed:${intentHash}` }
      );
      break;
    case 'partial':
      break;
  }
}

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

    const auth = await requireCallerScope(request, 'reputation:write');
    if (!auth.ok) return auth.response;

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

    if (!(await outcomeIntentMatchesHash(parsed.data))) {
      logger.warn({ event: 'append_outcome_intent_mismatch' });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'outcomeIntent does not hash to intentHash' },
        { status: 400 }
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

    const slippageResult = await detectSlippageBreach(
      row,
      parsed.data.outcomeIntent?.transactionId ?? null
    );

    let slippage: 'not_applicable' | 'met' | 'breach' | 'unrecorded';
    let breachCase: RefundCase | null = null;
    if (slippageResult.kind === 'breach') {
      slippage = 'breach';
      logger.info({
        event: 'slippage_breach_detected',
        anchorId: row.anchorId,
        intentHash: row.intentHash,
        shortfallBps: slippageResult.breach.shortfallBps,
      });
      try {
        breachCase = await openRefundCaseForBreach(slippageResult.breach);
      } catch (err) {
        logger.warn({
          event: 'refund_case_open_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (slippageResult.kind === 'error') {
      slippage = 'unrecorded';
      logger.warn({
        event: 'slippage_breach_write_failed',
        message: slippageResult.message,
      });
    } else {
      slippage = slippageResult.kind;
    }

    logger.info({
      event: 'outcome_appended',
      anchorId: row.anchorId,
      outcome: row.outcome,
      attested: true,
    });
    emitOutcomeEvents(row);
    // After the events of the outcome itself, so a subscriber learns of the outcome
    // before it learns that the outcome fell short.
    if (slippageResult.kind === 'breach') emitSlippageBreachEvent(slippageResult.breach);
    // And only then that a refund is now tracked for it (#2124).
    if (breachCase) emitRefundOpened(breachCase);

    // A refunded outcome, or a withdrawal that failed after the user paid,
    // opens a refund case with no user action (RFD004). A failure here never
    // changes the 201: the outcome itself is already recorded.
    try {
      const opened = await openRefundCaseForOutcome(row);
      if (opened) {
        logger.info({
          event: 'refund_case_opened',
          reason: opened.reason,
          intentHash: row.intentHash,
        });
      }
    } catch {
      logger.error({ event: 'refund_case_open_failed', intentHash: row.intentHash });
    }

    return NextResponse.json(
      { ok: true, intentHash: row.intentHash, attested: true, slippage },
      { status: 201 }
    );
  });
}
