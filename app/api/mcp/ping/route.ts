import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.mcp.ping', async (logger) => {
    logger.info({ event: 'ping' })
    return NextResponse.json({ ok: true })
  })
}
