import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';

export const runtime = 'nodejs';

/**
 * POST /api/v1/auth/token — exchange an API key for a short-lived scoped caller token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.auth.token', maxRequests: 10 }, async () => {
    return {
      status: 200,
      body: {
        token: 'stub-token',
        tokenType: 'Bearer',
        expiresIn: 900,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        scopes: ['quotes:read'],
        tier: 'standard',
      },
    };
  });
}
