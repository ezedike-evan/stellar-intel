import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { isFlag } from '@/lib/flags';
import { enforceRateLimit } from '@/lib/api/response';
import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import { hashIntent } from '@/lib/intent/hash';
import { verifyIntentSignature } from '@/lib/intent/verify';
import { RecurringExecutionIntentSchema } from '@/lib/recurring/execution';
import {
  getStandingAuthorizationStore,
  type StandingExecutionRecord,
} from '@/lib/recurring/authorization-store';
import { computeAuthorizationState } from '@/lib/recurring/due';
import { checkExecutionAgainstAuthorization } from '@/lib/recurring/enforce';
import type { ApiError } from '@/types';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RequestBodySchema = z
  .object({
    intent: RecurringExecutionIntentSchema,
    signature: z.string().min(1).max(200),
    publicKey: z.string().regex(STELLAR_PUBKEY_PATTERN),
  })
  .strict();

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json<ApiError>({ code, message }, { status });
}

// ─── POST /api/recurring/[id]/executions ──────────────────────────────────────
//
// Confirms one due cycle of a standing order (REC009). The body carries the
// off-ramp outcome intent the user signed for this cycle; the server verifies
// the signature, checks the payment against the signed terms (cap, stop date,
// allowlist, corridor) and records it as confirmed or rejected. A rejection is
// stored too, so the history shows the breach. Behind
// NEXT_PUBLIC_RECURRING_INTENTS, like the other /api/recurring routes.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isFlag('recurringIntents')) return error('NOT_FOUND', 'Not found', 404);

  return withRequestLogger(request, 'api.recurring.execute', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.recurring.execute',
      maxRequests: 20,
    });
    if (limited) return limited;

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error('VALIDATION_ERROR', 'Request body must be valid JSON', 400);
    }

    const parsed = RequestBodySchema.safeParse(body);
    if (!parsed.success) {
      return error(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid request body',
        400
      );
    }
    const { intent, signature, publicKey } = parsed.data;

    // Logs carry the id, the cycle and the result code only: never the sender
    // or the anchor transaction id.
    const done = (code: string) =>
      logger.info({
        event: 'standing_execution_result',
        id,
        cycleNumber: intent.cycleNumber,
        code,
      });

    const store = getStandingAuthorizationStore();
    const record = UUID_PATTERN.test(id) ? await store.get(id) : null;
    if (!record) {
      done('NOT_FOUND');
      return error('NOT_FOUND', 'Standing authorization not found', 404);
    }
    const { terms } = record.authorization;

    if (
      intent.recurringAuthorizationId !== id ||
      publicKey !== intent.sender ||
      intent.sender !== terms.sender
    ) {
      done('FORBIDDEN');
      return error('FORBIDDEN', 'The intent does not belong to this standing order', 403);
    }

    const intentHash = await hashIntent(intent);
    if (!verifyIntentSignature({ intentHash, publicKey, signature })) {
      done('UNAUTHORIZED');
      return error('UNAUTHORIZED', 'signature does not verify against publicKey', 401);
    }

    const now = new Date();
    const executions = await store.listExecutions(id);

    // An idempotent retry of a body the server has already recorded.
    const existing = executions.find((e) => e.intentHash === intentHash);
    if (existing) {
      done('ALREADY_RECORDED');
      return NextResponse.json(
        { execution: existing, state: computeAuthorizationState(record, executions, now) },
        { status: 200 }
      );
    }

    const state = computeAuthorizationState(record, executions, now);
    if (state.phase !== 'due' || !state.due) {
      done('NOT_DUE');
      return error('NOT_DUE', `No payment is due: the standing order is ${state.phase}`, 409);
    }
    if (intent.cycleNumber !== state.due.cycleNumber) {
      done('CYCLE_MISMATCH');
      return error(
        'CYCLE_MISMATCH',
        `The due cycle is ${state.due.cycleNumber}, not ${intent.cycleNumber}`,
        409
      );
    }

    const execution: StandingExecutionRecord = {
      id: randomUUID(),
      authorizationId: id,
      cycleNumber: intent.cycleNumber,
      periodIndex: state.due.periodIndex,
      amount: intent.amount,
      anchorId: intent.anchorId,
      intentHash,
      transactionId: intent.transactionId,
      status: 'confirmed',
      rejectCode: null,
      createdAt: now.toISOString(),
    };

    const check = checkExecutionAgainstAuthorization({
      terms,
      status: record.status,
      prior: executions
        .filter((e) => e.status === 'confirmed')
        .map((e) => ({ amount: e.amount, at: e.createdAt })),
      proposed: {
        corridorId: intent.corridor,
        sourceAsset: intent.sourceAsset,
        destinationAsset: intent.destinationAsset,
        anchorId: intent.anchorId,
        amount: intent.amount,
        at: now,
      },
    });

    if (!check.ok) {
      const code = check.code.toUpperCase();
      await store.appendExecution({ ...execution, status: 'rejected', rejectCode: check.code });
      done(code);
      return error(code, check.message, 422);
    }

    const appended = await store.appendExecution(execution);
    if (!appended.ok) {
      done('DUPLICATE_CYCLE');
      return error('DUPLICATE_CYCLE', 'This cycle has already been confirmed', 409);
    }

    const after = computeAuthorizationState(record, await store.listExecutions(id), now);
    done('CONFIRMED');
    return NextResponse.json({ execution, state: after }, { status: 201 });
  });
}
