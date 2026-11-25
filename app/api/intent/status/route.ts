import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { rateLimitedResponse, withRateLimitHeaders } from '@/lib/api/response';
import { parseAllowedTransferServer } from '@/lib/api/anchor-allowlist';
import { ANCHORS } from '@/constants/anchors';
import { SepError } from '@/lib/stellar/errors';
import { observeSettlementStatus } from '@/lib/webhooks/settlement-status';
import { withRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const KNOWN_ANCHOR_IDS = new Set(ANCHORS.map((a) => a.id));

const StatusBodySchema = z.object({
  anchorId: z.string().refine((id) => KNOWN_ANCHOR_IDS.has(id), {
    message: 'anchorId must be a registered anchor ID',
  }),
  transferServer: z.string().min(1),
  transactionId: z.string().min(1).max(200),
  protocol: z.enum(['sep24', 'sep6']),
  direction: z.enum(['withdraw', 'deposit']),
  intentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.intent.status', async (logger) => {
    // 1. Rate limit (api.intent.status, 60)
    const ip = getClientIp(request.headers);
    const rl = await checkRateLimit(ip, { bucket: 'api.intent.status', maxRequests: 60 });
    if (!rl.allowed) {
      logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
      return rateLimitedResponse(rl);
    }

    // 2. Parse body with Zod
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      const res = NextResponse.json(
        { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
      return withRateLimitHeaders(res, rl);
    }

    const parsed = StatusBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const res = NextResponse.json(
        { code: 'VALIDATION_ERROR', message: first?.message ?? 'Invalid request body' },
        { status: 400 }
      );
      return withRateLimitHeaders(res, rl);
    }
    const { anchorId, transferServer, transactionId, protocol, direction, intentHash } =
      parsed.data;

    // 3. Authorization: Bearer <jwt>
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      const res = NextResponse.json(
        { code: 'UNAUTHORIZED', message: 'Bearer token required' },
        { status: 401 }
      );
      return withRateLimitHeaders(res, rl);
    }
    const jwt = authHeader.slice(7).trim();
    if (!jwt) {
      const res = NextResponse.json(
        { code: 'UNAUTHORIZED', message: 'Bearer token required' },
        { status: 401 }
      );
      return withRateLimitHeaders(res, rl);
    }

    // 4. Allowed transfer server check
    if (parseAllowedTransferServer(transferServer) === null) {
      logger.warn({ event: 'transfer_server_not_allowed' });
      const res = NextResponse.json(
        {
          code: 'TRANSFER_SERVER_NOT_ALLOWED',
          message: 'transferServer is not on the registered anchor allowlist',
        },
        { status: 400 }
      );
      return withRateLimitHeaders(res, rl);
    }

    // 5 & 6. Observe settlement status
    try {
      const result = await observeSettlementStatus({
        anchorId,
        transferServer,
        transactionId,
        protocol,
        direction,
        intentHash,
        jwt,
      });

      logger.info({
        event: 'settlement_status_observed',
        anchorId,
        transactionId,
        status: result.status,
        changed: result.changed,
      });

      const res = NextResponse.json(result, { status: 200 });
      return withRateLimitHeaders(res, rl);
    } catch (err) {
      if (err instanceof SepError) {
        logger.warn({
          event: 'upstream_anchor_error',
          anchorId,
          transactionId,
          status: err.httpStatus,
        });
        const res = NextResponse.json(
          { code: 'UPSTREAM_ERROR', message: 'Upstream anchor returned an error' },
          { status: 502 }
        );
        return withRateLimitHeaders(res, rl);
      }
      throw err;
    }
  });
}
