import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { enforceRateLimit } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.mcp.ping', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.mcp.ping',
      maxRequests: 120,
    });
    if (limited) return limited;

    logger.info({ event: 'ping' });
    return NextResponse.json({ ok: true });
  });
}
