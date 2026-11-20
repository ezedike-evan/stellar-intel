import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { getCachedSep38Readiness } from '@/lib/stellar/sep38-readiness-cache';

export const runtime = 'nodejs';

/**
 * GET /api/v1/sep38/readiness — which anchors are ready to give firm (SEP-38)
 * quotes, from live data: quote server advertised, /info reachable, registered
 * asset listed. The page, the SDKs and outside readers share this one source.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.sep38.readiness', maxRequests: 30 }, async () => ({
    status: 200,
    body: await getCachedSep38Readiness(),
    headers: { 'Cache-Control': 'public, max-age=600' },
  }));
}
