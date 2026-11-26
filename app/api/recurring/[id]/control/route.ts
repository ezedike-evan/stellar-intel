import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import {
  apiErrorResponse,
  apiSuccessResponse,
  rateLimitedResponse,
  withRateLimitHeaders,
} from '@/lib/api/response';
import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import { RecurringControlSchema, applyControlAction } from '@/lib/recurring/control';
import { getStandingAuthorizationStore } from '@/lib/recurring/authorization-store';
import { computeAuthorizationState } from '@/lib/recurring/due';
import { hashIntent } from '@/lib/intent/hash';
import { verifyIntentSignature } from '@/lib/intent/verify';
import { registerIntentReplay } from '@/lib/intent/replay';

const RequestBodySchema = z
  .object({
    control: RecurringControlSchema,
    signature: z.string().min(1),
    publicKey: z.string().regex(STELLAR_PUBKEY_PATTERN),
  })
  .strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
): Promise<NextResponse> {
  // 1. Flag gate (same as REC007), then a rate limit (api.recurring.control, 20).
  if (!flags.recurringIntents) {
    return apiErrorResponse({ code: 'NOT_FOUND', message: 'Not found' }, 404);
  }

  const ip = getClientIp(request.headers);
  const rl = await checkRateLimit(ip, { bucket: 'api.recurring.control', maxRequests: 20 });
  if (!rl.allowed) {
    return rateLimitedResponse(rl);
  }

  const { id } = await Promise.resolve(context.params);

  // 2. A zod failure gives 400 VALIDATION_ERROR.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    const res = apiErrorResponse(
      { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
      400
    );
    return withRateLimitHeaders(res, rl);
  }

  const parsed = RequestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const res = apiErrorResponse(
      {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      },
      400
    );
    return withRateLimitHeaders(res, rl);
  }

  const { control, signature, publicKey } = parsed.data;

  // 3. An unknown id gives 404.
  const store = getStandingAuthorizationStore();
  const record = await store.get(id);
  if (!record) {
    const res = apiErrorResponse(
      { code: 'NOT_FOUND', message: 'Standing authorization not found' },
      404
    );
    return withRateLimitHeaders(res, rl);
  }

  const { terms } = record.authorization;

  // 4. If control.authorizationId differs from the path id, or control.sender, publicKey and terms.sender are not all equal,
  // or the control's sourceAsset/destinationAsset/amount differ from the terms: 403 FORBIDDEN.
  if (
    control.authorizationId !== id ||
    control.sender !== publicKey ||
    control.sender !== terms.sender ||
    control.sourceAsset !== terms.sourceAsset ||
    control.destinationAsset !== terms.destinationAsset ||
    control.amount !== terms.amount
  ) {
    const res = apiErrorResponse({ code: 'FORBIDDEN', message: 'Signer or terms mismatch' }, 403);
    return withRateLimitHeaders(res, rl);
  }

  // 5. If verifyIntentSignature({ intentHash: await hashIntent(control), publicKey, signature }) fails: 401 UNAUTHORIZED.
  const intentHash = await hashIntent(control);
  const validSig = verifyIntentSignature({
    intentHash,
    publicKey,
    signature,
  });
  if (!validSig) {
    const res = apiErrorResponse(
      { code: 'UNAUTHORIZED', message: 'Invalid signature for control message' },
      401
    );
    return withRateLimitHeaders(res, rl);
  }

  // 6. registerIntentReplay failure gives its status with code upper-cased.
  const replay = await registerIntentReplay({
    publicKey,
    nonce: control.nonce,
    deadline: control.deadline,
  });
  if (!replay.ok) {
    const res = apiErrorResponse(
      { code: replay.code.toUpperCase(), message: replay.message },
      replay.status
    );
    return withRateLimitHeaders(res, rl);
  }

  // 7. The phase is completed (from computeAuthorizationState) or applyControlAction fails: 409 INVALID_TRANSITION.
  const now = new Date();
  const executions = await store.listExecutions(id);
  const currentState = computeAuthorizationState(record, executions, now);

  if (currentState.phase === 'completed') {
    const res = apiErrorResponse(
      { code: 'INVALID_TRANSITION', message: 'Standing authorization is completed' },
      409
    );
    return withRateLimitHeaders(res, rl);
  }

  const transition = applyControlAction(record.status, control.action);
  if (!transition.ok) {
    const res = apiErrorResponse(
      { code: 'INVALID_TRANSITION', message: 'Invalid status transition' },
      409
    );
    return withRateLimitHeaders(res, rl);
  }

  // 8. setStatus then 200 { id, status, state }.
  const nowIso = now.toISOString();
  const updatedRecord = await store.setStatus(id, transition.status, nowIso);
  const updatedState = computeAuthorizationState(
    updatedRecord ?? { ...record, status: transition.status, updatedAt: nowIso },
    executions,
    now
  );

  const res = apiSuccessResponse({
    id,
    status: transition.status,
    state: updatedState,
  });
  return withRateLimitHeaders(res, rl);
}
