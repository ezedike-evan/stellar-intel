import { NextRequest, NextResponse } from 'next/server';
import { API_VERSION, SUPPORTED_API_VERSIONS } from '@/lib/api/api-version';

/**
 * API status endpoint.
 *
 * Returns the current API version and the list of announced
 * deprecations. This is the endpoint that `docs/VERSIONING.md`
 * promises exists under `/api/status`.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const supportedVersions = SUPPORTED_API_VERSIONS;

  const status = {
    version: API_VERSION,
    supportedVersions,
    announced_deprecations: [
      {
        version: supportedVersions[0],
        status: 'current',
        sunset: null,
      },
      {
        version: supportedVersions[1],
        status: 'deprecated',
        sunset: null,
      },
    ],
  };

  return NextResponse.json(status);
}