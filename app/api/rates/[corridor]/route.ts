import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { withRequestLogger } from '@/lib/logger';
import { isValidCorridorId } from '@/lib/stellar/anchors';
import { fetchCorridorRates } from '@/lib/stellar/server-rates';
import { AMOUNT_PATTERN } from '@/lib/patterns';

// Live anchor calls must run per-request, never at build time.
export const dynamic = 'force-dynamic';

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
    const ip = getClientIp(request.headers);
    const rl = checkRateLimit(ip, { bucket: 'api.rates', maxRequests: 90 });
    if (!rl.allowed) {
      logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rl.retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': String(rl.retryAfter),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

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

    // Listing rates aren't a locked-in quote — execution re-authenticates and
    // re-quotes with the anchor from scratch, so a short shared cache here
    // only affects how stale the comparison table can be, not correctness.
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=60',
        'X-RateLimit-Remaining': String(rl.remaining),
      },
    });
  });
}
