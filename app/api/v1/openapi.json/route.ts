import { NextRequest, NextResponse } from 'next/server';
import { buildOpenApiSpec } from '@/lib/api/openapi';
import { enforceRateLimit } from '@/lib/api/response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Rate-limited like every other public route (#733): the document is cheap
  // to serve but is rebuilt per request, and tests/rate-limit-coverage.spec.ts
  // requires a limit on any route that is not explicitly exempted.
  const limited = await enforceRateLimit(request, {
    bucket: 'api.openapi',
    maxRequests: 60,
  });
  if (limited) return limited;

  const spec = buildOpenApiSpec();
  return NextResponse.json(spec, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
