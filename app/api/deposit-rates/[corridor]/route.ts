import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { withRequestLogger } from '@/lib/logger';
import { isValidCorridorId } from '@/lib/stellar/anchors';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import { fetchDepositRates } from '@/lib/stellar/deposit-rates';

// Live anchor calls must run per-request, never at build time.
export const dynamic = 'force-dynamic';

// ─── GET /api/deposit-rates/[corridor]?amount=150000&asset=stellar:... ─────────
//
// Server-side deposit estimate proxy for /onramp (interim ONR013): runs
// `fetchDepositRates` from Node so anchor TOML / SEP-24 /info / reference-price
// fetches never hit the browser's CORS policy. Every figure is indicative; the
// anchor sets the firm conversion inside its interactive deposit flow.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ corridor: string }> | { corridor: string } }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.deposit-rates', async (logger) => {
    const ip = getClientIp(request.headers);
    const rl = await checkRateLimit(ip, { bucket: 'api.deposit-rates', maxRequests: 90 });
    if (!rl.allowed) {
      logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rl.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfter), 'X-RateLimit-Remaining': '0' },
        }
      );
    }

    const { corridor } = await params;
    if (!corridor || !isValidCorridorId(corridor)) {
      logger.warn({ event: 'invalid_corridor', corridor });
      return NextResponse.json({ error: `Unknown corridor: "${corridor}"` }, { status: 400 });
    }

    const url = new URL(request.url);
    const amount = url.searchParams.get('amount') ?? '100';
    if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
      logger.warn({ event: 'invalid_amount', amount });
      return NextResponse.json(
        { error: 'amount must be a positive decimal string' },
        { status: 400 }
      );
    }

    const asset = url.searchParams.get('asset') ?? undefined;

    try {
      const comparison = await fetchDepositRates(corridor, amount, asset ? { asset } : {});
      logger.info({
        event: 'deposit_rates_resolved',
        corridor,
        rows: comparison.rates.length,
        errors: comparison.errors.length,
      });
      return NextResponse.json(comparison);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ event: 'deposit_rates_failed', corridor, error: message });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  });
}
