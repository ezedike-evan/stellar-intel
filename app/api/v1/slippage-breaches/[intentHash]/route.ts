import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { INTENT_HASH_PATTERN } from '@/lib/reputation/schema';
import { getSlippageBreachStore } from '@/lib/reputation/slippage-breaches';
import { canonicalEvidenceJson } from '@/lib/reputation/slippage-evidence';
import { toPublicBreachSummary } from '@/lib/reputation/slippage-public';
import type { SlippageBreach } from '@/types/reputation';

export const runtime = 'nodejs';

/**
 * GET /api/v1/slippage-breaches/[intentHash] — public detail endpoint for a slippage breach.
 * Validates 64-character hex intentHash, returns public summary plus evidence
 * and canonical evidence JSON string for independent cryptographic verification.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ intentHash: string }> }
): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.slippage-breach', maxRequests: 60 }, async (ctx) => {
    const { intentHash } = await params;
    if (!INTENT_HASH_PATTERN.test(intentHash)) {
      return ctx.error(
        'validation_error',
        'intentHash must be a lowercase hex SHA-256 (64 chars)',
        400
      );
    }

    let breach: SlippageBreach | null;
    try {
      breach = await getSlippageBreachStore().get(intentHash);
    } catch {
      return ctx.error('store_unavailable', 'Slippage breach store is not available', 503);
    }

    if (!breach) {
      return ctx.error('not_found', `Slippage breach not found for intent: "${intentHash}"`, 404);
    }

    return {
      status: 200,
      body: {
        ...toPublicBreachSummary(breach),
        evidence: breach.evidence,
        canonicalEvidence: canonicalEvidenceJson(breach.evidence),
      },
      headers: { 'Cache-Control': 'public, max-age=300' },
    };
  });
}
