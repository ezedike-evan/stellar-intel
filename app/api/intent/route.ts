import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { withRequestLogger } from '@/lib/logger';
import { GenericIntentSchema, expandIntent, type OfframpLeg } from '@/lib/intent/generic';
import type { ApiError } from '@/types';

export interface IntentPlanResponse {
  type: string;
  count: number;
  intents: OfframpLeg[];
}

/**
 * POST /api/intent — the generic intent entrypoint (issue #818).
 *
 * Accepts the canonical intent (a single off-ramp or a recurring schedule) and
 * returns the collapsed plan: the concrete off-ramp legs to execute. The
 * off-ramp-specific `/api/intent/offramp` route stays as a thin compatibility
 * shim for existing callers.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.intent', async (logger) => {
    const ip = getClientIp(request.headers);
    const rl = checkRateLimit(ip, { bucket: 'api.intent', maxRequests: 20 });
    if (!rl.allowed) {
      logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rl.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfter), 'X-RateLimit-Remaining': '0' },
        }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<ApiError>(
        { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const parsed = GenericIntentSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      logger.warn({ event: 'validation_failed', issues: parsed.error.issues });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: first?.message ?? 'Invalid intent payload' },
        { status: 400 }
      );
    }

    const intents = expandIntent(parsed.data);
    logger.info({ event: 'intent_expanded', type: parsed.data.type, count: intents.length });
    return NextResponse.json<IntentPlanResponse>({
      type: parsed.data.type,
      count: intents.length,
      intents,
    });
  });
}
