import type { NextRequest, NextResponse } from 'next/server';
import { withV1, API_V1 } from '@/lib/api/v1';

export const runtime = 'nodejs';

/**
 * GET /api/v1/health — liveness probe on the stable public v1 surface. Carries
 * the same `X-RateLimit-*` headers and request id as every other v1 route.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.health', maxRequests: 60 }, async () => ({
    status: 200,
    body: { status: 'ok', version: API_V1, ts: new Date().toISOString() },
  }));
}
