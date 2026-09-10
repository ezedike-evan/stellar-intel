import type { NextRequest, NextResponse } from 'next/server';
import { withV1, API_V1 } from '@/lib/api/v1';

export const runtime = 'nodejs';

/**
 * GET /api/v1/health — liveness probe on the stable public v1 surface. Carries
 * the same `X-RateLimit-*` headers and request id as every other v1 route.
 *
 * Also answers `GET /api/mcp/ping`, which next.config.ts rewrites here as
 * `?probe=mcp`. Two liveness handlers meant two Vercel Function bundles — and
 * two traced copies of every dependency they reach — for a few bytes of JSON.
 * The rewrite keeps both public paths, both response bodies, and both
 * rate-limit buckets; only the number of deployed functions changes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.searchParams.get('probe') === 'mcp') {
    return withV1(request, { bucket: 'api.mcp.ping', maxRequests: 120 }, async () => ({
      status: 200,
      body: { ok: true },
    }));
  }

  return withV1(request, { bucket: 'v1.health', maxRequests: 60 }, async () => ({
    status: 200,
    body: { status: 'ok', version: API_V1, ts: new Date().toISOString() },
  }));
}
