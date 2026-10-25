import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { computeQuoteGapStats, type QuoteGapWindowDays } from '@/lib/reputation/quote-gap';
import { tryGetReputationStore } from '@/lib/reputation/store';
import { getAnchorById } from '@/lib/stellar/anchors';

export const runtime = 'nodejs';

const WINDOWS: readonly QuoteGapWindowDays[] = [7, 30, 90];
const DEFAULT_WINDOW: QuoteGapWindowDays = 30;
const BASIS = 'all-in rate: amount_out / amount_in vs rate shown before execution';

/**
 * GET /api/v1/anchors/[id]/quote-gap — how far the anchor's landed rate drifts
 * from the rate it showed, as a signed percentage over completed withdrawals.
 * The practical stand-in for SEP-38 firm quotes that most anchors do not offer.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.anchor.quote-gap', maxRequests: 60 }, async (ctx) => {
    const { id } = await params;

    try {
      getAnchorById(id);
    } catch {
      return ctx.error('not_found', `Unknown anchor: "${id}"`, 404);
    }

    let windowDays = DEFAULT_WINDOW;
    const windowRaw = new URL(request.url).searchParams.get('window');
    if (windowRaw !== null && windowRaw !== '') {
      const parsed = Number(windowRaw);
      if (!WINDOWS.includes(parsed as QuoteGapWindowDays)) {
        return ctx.error('validation_error', `window must be one of ${WINDOWS.join(', ')}`, 400);
      }
      windowDays = parsed as QuoteGapWindowDays;
    }

    const store = tryGetReputationStore();
    if (!store) {
      return ctx.error('store_unavailable', 'Reputation store is not available', 503);
    }

    let rows;
    try {
      rows = await store.query({ anchorId: id, direction: 'withdraw' });
    } catch {
      return ctx.error('store_unavailable', 'Reputation store is not available', 503);
    }

    return {
      status: 200,
      body: { anchorId: id, basis: BASIS, ...computeQuoteGapStats(rows, { windowDays }) },
      headers: { 'Cache-Control': 'public, max-age=300' },
    };
  });
}
