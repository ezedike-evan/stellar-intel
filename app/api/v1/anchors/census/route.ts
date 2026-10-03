import { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import census from '@/constants/anchor-census-rows.json';
import type { AnchorCensus, AnchorCensusRow } from '@/types';

export const runtime = 'nodejs';

const VALID_TIERS: ReadonlySet<AnchorCensusRow['tier']> = new Set([
  'routable',
  'health-only',
  'listed',
]);

/**
 * `GET /api/v1/anchors/census[?tier=routable|health-only|listed]` (#1324)
 *
 * Serves the committed anchor census (constants/anchor-census-rows.json, written by
 * `node scripts/anchor-survey.mjs --census-out <path>`, see #1322) so every
 * surveyed anchor — routable, health-only, or merely listed — is queryable,
 * not only the anchors registered in constants/anchors.ts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.anchors.census', maxRequests: 60 }, async (ctx) => {
    const tier = request.nextUrl.searchParams.get('tier');
    if (tier !== null && !VALID_TIERS.has(tier as AnchorCensusRow['tier'])) {
      return ctx.error(
        'validation_error',
        `Invalid tier "${tier}" — expected one of routable, health-only, listed.`,
        400
      );
    }

    const typedCensus = census as AnchorCensus;
    const rows = tier ? typedCensus.rows.filter((row) => row.tier === tier) : typedCensus.rows;

    return {
      status: 200,
      body: { generatedAt: typedCensus.generatedAt, counts: typedCensus.counts, rows },
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
        ETag: `"anchor-census-${typedCensus.generatedAt ?? 'empty'}"`,
      },
    };
  });
}
