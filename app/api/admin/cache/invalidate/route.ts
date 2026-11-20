import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminRequest } from '@/lib/auth/admin';
import { withRequestLogger } from '@/lib/logger';
import { invalidateCachedRates, clearRateCache } from '@/lib/api/rate-cache';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';

const InvalidateBodySchema = z.object({
  anchorId: z.string().trim().min(1).max(64).optional(),
  all: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.cache.invalidate', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.admin.cache-invalidate',
      maxRequests: 30,
    });
    if (limited) return limited;

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

    // A non-string anchorId used to reach `.trim()` and throw a 500.
    const parsed = InvalidateBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ event: 'validation_failed', issues: parsed.error.issues.length });
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: 'anchorId must be a non-empty string and all must be a boolean',
        },
        { status: 400 }
      );
    }

    const anchorId = parsed.data.anchorId;
    const shouldInvalidateAll = parsed.data.all === true;

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
