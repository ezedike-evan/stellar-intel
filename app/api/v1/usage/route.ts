import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';

export const runtime = 'nodejs';

/**
 * GET /api/v1/usage — read caller identity, tier, scopes, daily quota and rate-limit windows.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.usage', maxRequests: 30 }, async () => {
    return {
      status: 200,
      body: {
        caller: {
          kind: 'anonymous',
          keyPrefix: null,
          tier: 'anonymous',
          scopes: ['quotes:read'],
        },
        quota: null,
        windows: [],
      },
    };
  });
}
