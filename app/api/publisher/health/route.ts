import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { withRequestLogger } from '@/lib/logger';
import { getDurablePublisherHealth } from '@/lib/reputation/publisherHealth';

/**
 * GET /api/publisher/health
 *
 * Returns the current publisher health status.
 *
 * Durable (from `outcome_log`, survives cold starts):
 * - lastPublishedAt: when a row last reached the oracle
 * - publishedStaleMs: how long ago that was
 * - pendingCount: reconciled rows still waiting to publish
 * - durable: false when no database is configured, so a caller can tell
 *   "nothing is wrong" apart from "cannot tell"
 *
 * In-process (best effort, resets on cold start):
 * - lastRun / lastBatchSize / lastError / staleSinceMs
 *
 * The durable fields exist because the in-process ones are per-instance on
 * serverless — alerting on them alone fires on cold starts and stays quiet
 * through real outages (#910).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.publisher.health', async (logger) => {
    const ip = getClientIp(request.headers);
    const rl = checkRateLimit(ip, { bucket: 'api.publisher.health', maxRequests: 120 });
    if (!rl.allowed) {
      logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rl.retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': String(rl.retryAfter),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const health = await getDurablePublisherHealth();

    logger.info({
      event: 'publisher_health_check',
      lastRun: health.lastRun,
      lastPublishedAt: health.lastPublishedAt,
      publishedStaleMs: health.publishedStaleMs,
      pendingCount: health.pendingCount,
      durable: health.durable,
      hasError: !!health.lastError,
    });

    return NextResponse.json(health, {
      headers: { 'X-RateLimit-Remaining': String(rl.remaining) },
    });
  });
}
