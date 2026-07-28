import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { withRequestLogger } from '@/lib/logger';
import { getAnchorById, getAnchorHealth } from '@/lib/stellar/anchors';
import type { AnchorHealth } from '@/lib/stellar/anchors';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface AnchorHealthResponse {
  anchorId: string;
  status: AnchorHealth['lastStatus'] | 'stale';
  consecutiveFailures: number;
  degraded: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  stale: boolean;
}

const ParamsSchema = z.object({
  id: z.string().min(1),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.v1.anchor.health', async (logger) => {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';

    const rl = checkRateLimit(ip);
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

    const resolvedParams = await params;
    const parsed = ParamsSchema.safeParse(resolvedParams);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Invalid anchor ID' },
        { status: 400 }
      );
    }

    const { id } = parsed.data;

    try {
      getAnchorById(id);
    } catch {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: `Unknown anchor: "${id}"` },
        { status: 404 }
      );
    }

    const health = getAnchorHealth(id);

    if (!health) {
      const response: AnchorHealthResponse = {
        anchorId: id,
        status: 'unknown',
        consecutiveFailures: 0,
        degraded: false,
        lastCheckedAt: null,
        lastError: null,
        stale: true,
      };

      logger.info({ event: 'health_returned', anchorId: id, status: 'unknown' });
      return NextResponse.json(response, {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
          'X-RateLimit-Remaining': String(rl.remaining),
        },
      });
    }

    const lastCheckedMs = health.lastCheckedAt ? new Date(health.lastCheckedAt).getTime() : 0;
    const isStale = lastCheckedMs === 0 || Date.now() - lastCheckedMs > STALE_THRESHOLD_MS;

    let status: AnchorHealthResponse['status'];
    if (isStale) {
      status = 'stale';
    } else {
      status = health.lastStatus as AnchorHealthResponse['status'];
    }

    const response: AnchorHealthResponse = {
      anchorId: id,
      status,
      consecutiveFailures: health.consecutiveFailures,
      degraded: health.degraded,
      lastCheckedAt: health.lastCheckedAt,
      lastError: health.lastError,
      stale: isStale,
    };

    logger.info({ event: 'health_returned', anchorId: id, status, stale: isStale });
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        'X-RateLimit-Remaining': String(rl.remaining),
      },
    });
  });
}
