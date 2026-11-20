import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withV1 } from '@/lib/api/v1';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import { isValidCorridorId } from '@/lib/stellar/anchors';
import { fetchDepositRates } from '@/lib/stellar/deposit-rates';

export const runtime = 'nodejs';

const SEP38_ASSET_PATTERN = /^stellar:(native|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/;
const MAX_AMOUNT_DECIMALS = 7;

const QuerySchema = z.object({
  corridor: z.string().refine(isValidCorridorId, { message: 'Unknown corridor' }),
  amount: z
    .string()
    .regex(AMOUNT_PATTERN, 'amount must be a positive decimal string')
    .refine((v) => (v.split('.')[1]?.length ?? 0) <= MAX_AMOUNT_DECIMALS, {
      message: `amount allows at most ${MAX_AMOUNT_DECIMALS} decimal places`,
    })
    .refine((v) => Number(v) > 0, { message: 'amount must be greater than zero' }),
  asset: z
    .string()
    .regex(SEP38_ASSET_PATTERN, 'asset must be a SEP-38 identifier (stellar:CODE:ISSUER)')
    .optional(),
  type: z.enum(['bank_account', 'cash', 'mobile_money']).default('bank_account'),
});

const DISCLAIMER = 'Estimate only. The anchor sets the final rate in its deposit window.';

/**
 * GET /api/v1/onramp/quote — public, rate-limited deposit quote.
 *
 * Every figure is indicative: SEP-24 publishes deposit fees but the fiat→asset
 * conversion is set inside the anchor's interactive flow. Rows come from
 * `fetchDepositRates`, with dates serialised as ISO strings.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.onramp.quote', maxRequests: 60 }, async (ctx) => {
    const query = new URL(request.url).searchParams;
    const parsed = QuerySchema.safeParse({
      corridor: query.get('corridor') ?? undefined,
      amount: query.get('amount') ?? undefined,
      asset: query.get('asset') ?? undefined,
      type: query.get('type') ?? undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0] ? `${String(issue.path[0])}: ` : '';
      return ctx.error('validation_error', `${field}${issue?.message ?? 'Invalid query'}`, 400);
    }
    const { corridor, amount, asset, type } = parsed.data;

    let comparison;
    try {
      comparison = await fetchDepositRates(corridor, amount, { type, ...(asset ? { asset } : {}) });
    } catch {
      return ctx.error('upstream_unavailable', 'Could not fetch deposit rates', 502);
    }

    return {
      status: 200,
      body: {
        ...comparison,
        rates: comparison.rates.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
        indicative: true,
        disclaimer: DISCLAIMER,
      },
      headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' },
    };
  });
}
