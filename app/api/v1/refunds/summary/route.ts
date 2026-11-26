import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { computeRefundGateMetrics, refundGateWindowStart } from '@/lib/refunds/metrics';
import { getRefundStore } from '@/lib/refunds/store';

export const runtime = 'nodejs';

/**
 * GET /api/v1/refunds/summary — the v3 release-gate metric "0 unsignaled refunds in
 * the trailing 30 days" (#2121), as counts anyone can check. The body is the output
 * of `computeRefundGateMetrics`: no accounts, no intent hashes, no amounts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(
    request,
    { bucket: 'v1.refunds.summary', maxRequests: 60, scope: 'quotes:read' },
    async () => {
      const now = new Date();
      const cases = await getRefundStore().list({
        openedSince: refundGateWindowStart(now).toISOString(),
      });
      return {
        status: 200,
        body: computeRefundGateMetrics(cases, now),
        headers: { 'Cache-Control': 'public, max-age=60' },
      };
    }
  );
}
