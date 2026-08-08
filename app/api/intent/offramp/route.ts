import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { getIdempotentResponse, storeIdempotentResponse } from '@/lib/api/idempotency';
import {
  API_VERSION,
  apiErrorResponse,
  apiSuccessResponse,
  rateLimitedResponse,
  withRateLimitHeaders,
} from '@/lib/api/response';
import { withRequestLogger } from '@/lib/logger';
import { recordIntentError, recordIntentSuccess } from '@/lib/metrics';
import { IntentSchema, createOfframpIntent } from '@/lib/intent/offramp';
import { verifyOptionalIntentAttestation } from '@/lib/intent/verify';
import type { Intent } from '@/lib/intent/hash';
import type { ApiError } from '@/types';

// Response types now live with the shared core; re-exported for existing importers.
export type { OfframpRoute, OfframpIntentResponse } from '@/lib/intent/offramp';
import type { OfframpIntentResponse } from '@/lib/intent/offramp';

// ─── Internal route handler (unversioned; see /api/v1/intent/offramp for the
// hardened public surface). Delegates the routing + tx assembly to the shared
// `createOfframpIntent` core. ────────────────────────────────────────────────

/**
 * Responses that are safe to replay verbatim for a repeated Idempotency-Key:
 * deterministic outcomes given the same input (success, or a validation/
 * routing error that will not change on retry). 500s are deliberately never
 * cached -- a transient failure should not be pinned to a key, since a
 * retry might succeed once the underlying issue clears.
 */
function isIdempotentCacheable(status: number): boolean {
  return status === 200 || status === 400;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.intent.offramp', async (logger) => {
    const idempotencyKey = request.headers.get('idempotency-key');

    if (idempotencyKey) {
      const cached = await getIdempotentResponse(idempotencyKey);
      if (cached) {
        logger.info({ event: 'idempotent_replay', idempotencyKey });
        const response = NextResponse.json(cached.body, {
          status: cached.status,
          headers: { ...cached.headers, 'Idempotency-Replayed': 'true' },
        });
        response.headers.set('API-Version', API_VERSION);
        return response;
      }
    }

    const ip = getClientIp(request.headers);
    const rl = await checkRateLimit(ip, { bucket: 'api.intent.offramp', maxRequests: 20 });
    if (!rl.allowed) {
      logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
      return rateLimitedResponse(rl);
    }

    // Async because the idempotency write has to land before the response is
    // returned — on serverless the instance can be frozen the moment the
    // handler resolves, and a floating write would simply be lost.
    const respond = async <T>(payload: T, status: number): Promise<NextResponse> => {
      const response =
        status >= 400
          ? apiErrorResponse(payload as ApiError, status)
          : apiSuccessResponse(payload, { status });
      withRateLimitHeaders(response, rl);
      if (idempotencyKey && isIdempotentCacheable(status)) {
        await storeIdempotentResponse(idempotencyKey, status, payload);
      }
      return response;
    };

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      logger.warn({ event: 'invalid_json', message: 'Request body must be valid JSON' });
      recordIntentError('INVALID_JSON');
      return await respond<ApiError>(
        { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        400
      );
    }

    const parsed = IntentSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      logger.warn({ event: 'validation_failed', issues: parsed.error.issues });
      recordIntentError('VALIDATION_ERROR');
      return await respond<ApiError>(
        { code: 'VALIDATION_ERROR', message: first?.message ?? 'Invalid intent payload' },
        400
      );
    }

    const intent = parsed.data as Intent;

    // Optional signature attestation: when the caller supplies a signed envelope
    // it is verified over the canonical intent hash and a bad one is rejected;
    // unsigned intents are still accepted (see lib/intent/verify.ts).
    const attestation = await verifyOptionalIntentAttestation(body, intent);
    if (!attestation.ok) {
      logger.warn({ event: 'intent_attestation_rejected', status: attestation.status });
      recordIntentError(attestation.status === 401 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR');
      return await respond<ApiError>(
        {
          code: attestation.status === 401 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR',
          message: attestation.message,
        },
        attestation.status
      );
    }

    logger.info({
      event: 'intent_parsed',
      sourceAsset: intent.sourceAsset,
      destinationAsset: intent.destinationAsset,
      attested: attestation.attested,
    });

    const result = await createOfframpIntent(intent);
    if (!result.ok) {
      logger.warn({
        event: result.code === 'NO_ROUTE' ? 'no_route' : 'tx_build_failed',
        ...intent,
      });
      recordIntentError(result.code);
      // A 500 (TX_BUILD_FAILED) is deliberately not cached under the
      // idempotency key -- isIdempotentCacheable excludes it, so a retry with
      // the same key tries building again.
      return await respond<ApiError>({ code: result.code, message: result.message }, result.status);
    }

    logger.info({
      event: 'intent_response',
      corridorId: result.response.route.corridorId,
      quoteId: result.response.quoteId,
    });
    recordIntentSuccess();
    return await respond<OfframpIntentResponse>(result.response, 200);
  });
}
