import { NextRequest, NextResponse } from 'next/server';
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
    const health = getPublisherHealth();

    logger.info({
      event: 'publisher_health_check',
      lastRun: health.lastRun,
      staleSinceMs: health.staleSinceMs,
      hasError: !!health.lastError,
    });

    return NextResponse.json(health);
  });
}
