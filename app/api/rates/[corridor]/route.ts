import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { isValidCorridorId } from '@/lib/stellar/anchors';
import { fetchCorridorRates } from '@/lib/stellar/server-rates';

// Live anchor calls must run per-request, never at build time.
export const dynamic = 'force-dynamic';

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

// ─── GET /api/rates/[corridor]?amount=100 ────────────────────────────────────
//
// Server-side SEP-38 quote proxy. Fetches each anchor's stellar.toml and live
// /price from Node so the browser's CORS policy never blocks third-party anchor
// domains. Returns the full RateComparison plus per-anchor error reasons.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ corridor: string }> | { corridor: string } }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.rates', async (logger) => {
    const { corridor } = await params;

    if (!corridor || !isValidCorridorId(corridor)) {
      logger.warn({ event: 'invalid_corridor', corridor });
      return NextResponse.json({ error: `Unknown corridor: "${corridor}"` }, { status: 400 });
    }

    const amount = new URL(request.url).searchParams.get('amount') ?? '100';
    if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
      logger.warn({ event: 'invalid_amount', amount });
      return NextResponse.json(
        { error: 'amount must be a positive decimal string' },
        { status: 400 }
      );
    }

    const result = await fetchCorridorRates(corridor, amount);
    logger.info({
      event: 'rates_fetched',
      corridor,
      amount,
      quoted: result.rates.length,
      failed: result.errors.length,
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
