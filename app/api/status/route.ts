import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { enforceRateLimit } from '@/lib/api/response';
import { API_VERSION, SUPPORTED_API_VERSIONS } from '@/lib/api/api-version';
import { getAnnouncedDeprecations } from '@/lib/api/deprecation';

/**
 * GET /api/status — the "Status page" announcement channel docs/VERSIONING.md
 * describes: current API version, the supported window, and any announced
 * deprecations, so a consumer can check the deprecation lifecycle without
 * parsing response headers off a live request.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.status', async () => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.status',
      maxRequests: 120,
    });
    if (limited) return limited;

    return NextResponse.json({
      version: API_VERSION,
      supported_versions: SUPPORTED_API_VERSIONS,
      announced_deprecations: getAnnouncedDeprecations(),
    });
  });
}
