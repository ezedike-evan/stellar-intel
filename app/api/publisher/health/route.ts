import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { withRequestLogger } from '@/lib/logger';
import { getPublisherHealth } from '@/lib/metrics';

/**
 * GET /api/publisher/health
 *
 * Returns the current publisher health status including:
 * - lastRun: ISO timestamp of last publisher execution
 * - lastBatchSize: number of items processed in last batch
 * - lastError: last error message (null if successful)
 * - staleSinceMs: milliseconds since last run (null if never run)
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

    const health = getPublisherHealth();

    logger.info({
      event: 'publisher_health_check',
      lastRun: health.lastRun,
      staleSinceMs: health.staleSinceMs,
      hasError: !!health.lastError,
    });

    return NextResponse.json(health, {
      headers: { 'X-RateLimit-Remaining': String(rl.remaining) },
    });
  });
}
