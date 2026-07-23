import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/auth/admin';
import { withRequestLogger } from '@/lib/logger';
import { invalidateCachedRates, clearRateCache } from '@/lib/api/rate-cache';
import type { ApiError } from '@/types';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.cache.invalidate', async (logger) => {
    if (!isAdminRequest(request)) {
      logger.warn({ event: 'unauthorized_access', path: request.nextUrl.pathname });
      return NextResponse.json<ApiError>(
        { code: 'UNAUTHORIZED', message: 'Admin access required' },
        { status: 401 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      logger.warn({ event: 'invalid_json', message: 'Request body must be valid JSON' });
      return NextResponse.json<ApiError>(
        { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const payload = body as { anchorId?: string; all?: boolean };
    const anchorId = payload.anchorId?.trim();
    const shouldInvalidateAll = payload.all === true;

    if (!anchorId && !shouldInvalidateAll) {
      logger.warn({ event: 'validation_failed', anchorId, all: shouldInvalidateAll });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'Provide anchorId or set all to true' },
        { status: 400 }
      );
    }

    if (anchorId && shouldInvalidateAll) {
      logger.warn({ event: 'validation_failed', anchorId, all: shouldInvalidateAll });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'Provide either anchorId or all=true, not both' },
        { status: 400 }
      );
    }

    if (anchorId) {
      invalidateCachedRates(anchorId);
      logger.info({ event: 'cache_invalidated', anchorId });
      return NextResponse.json({ ok: true, anchorId });
    }

    clearRateCache();
    logger.info({ event: 'cache_invalidated', scope: 'all' });
    return NextResponse.json({ ok: true, scope: 'all' });
  });
}
