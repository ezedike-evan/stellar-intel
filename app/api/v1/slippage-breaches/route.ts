import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { ANCHORS } from '@/constants/anchors';
import { SLIPPAGE_BREACH_STATUSES, type SlippageBreachStatus } from '@/types/reputation';
import { getSlippageBreachStore } from '@/lib/reputation/slippage-breaches';
import { toPublicBreachSummary } from '@/lib/reputation/slippage-public';

export const runtime = 'nodejs';

/**
 * GET /api/v1/slippage-breaches — public list of detected slippage breaches.
 * Supports filtering by anchorId and status, with limit (1–500, default 100).
 * Excludes sensitive fields (signerAccount, recipient, evidence).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(
    request,
    { bucket: 'v1.slippage-breaches', maxRequests: 60, scope: 'quotes:read' },
    async (ctx) => {
      const url = new URL(request.url);
      const anchorId = url.searchParams.get('anchorId');
      const status = url.searchParams.get('status');
      const limitRaw = url.searchParams.get('limit');

      if (anchorId !== null && anchorId !== '') {
        const knownAnchor = ANCHORS.some((a) => a.id === anchorId);
        if (!knownAnchor) {
          return ctx.error('validation_error', `Unknown anchor: "${anchorId}"`, 400);
        }
      }

      if (status !== null && status !== '') {
        if (!SLIPPAGE_BREACH_STATUSES.includes(status as SlippageBreachStatus)) {
          return ctx.error('validation_error', 'Invalid status', 400);
        }
      }

      let parsedLimit = 100;
      if (limitRaw !== null && limitRaw !== '') {
        if (!/^\d+$/.test(limitRaw)) {
          return ctx.error('validation_error', 'limit must be an integer between 1 and 500', 400);
        }
        const n = Number(limitRaw);
        if (n < 1 || n > 500) {
          return ctx.error('validation_error', 'limit must be an integer between 1 and 500', 400);
        }
        parsedLimit = n;
      }

      let rows;
      try {
        const store = getSlippageBreachStore();
        const filter: {
          anchorId?: string;
          status?: SlippageBreachStatus;
          limit: number;
        } = { limit: parsedLimit };
        if (anchorId && anchorId !== '') {
          filter.anchorId = anchorId;
        }
        if (status && status !== '') {
          filter.status = status as SlippageBreachStatus;
        }
        rows = await store.list(filter);
      } catch {
        return ctx.error('store_unavailable', 'Slippage breach store is not available', 503);
      }

      return {
        status: 200,
        body: { breaches: rows.map(toPublicBreachSummary) },
        headers: { 'Cache-Control': 'public, max-age=60' },
      };
    }
  );
}
