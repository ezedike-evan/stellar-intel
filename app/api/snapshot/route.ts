import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { getBestAnchorSnapshot } from '@/lib/stellar/snapshot';

export const runtime = 'nodejs';

// Serve the landing teaser from a cached snapshot rather than a live anchor fan-out.
// Next revalidates the cached response at most every 10 minutes; the underlying
// snapshot is additionally memoized in-process. A post-deploy cron can GET this
// endpoint to warm the cache. See lib/stellar/snapshot.ts.
export const revalidate = 600;

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

// ─── GET /api/snapshot?amount=100 ────────────────────────────────────────────
//
// Returns the best anchor per corridor for `amount` (default 100) of USDC. The
// response is a stable BestAnchorSnapshot the landing teaser (#B080) can render
// without making any live call of its own.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.snapshot', async (logger) => {
    const amount = new URL(request.url).searchParams.get('amount');
    if (amount !== null && (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0)) {
      logger.warn({ event: 'invalid_amount', amount });
      return NextResponse.json(
        { error: 'amount must be a positive decimal string' },
        { status: 400 }
      );
    }

    const snapshot = await getBestAnchorSnapshot(amount ? { baseAmount: amount } : undefined);
    logger.info({
      event: 'snapshot_served',
      baseAmount: snapshot.baseAmount,
      corridors: snapshot.corridors.length,
      withBest: snapshot.corridors.filter((c) => c.best !== null).length,
    });

    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400' },
    });
  });
}
