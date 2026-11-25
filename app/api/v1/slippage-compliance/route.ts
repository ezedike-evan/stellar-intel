import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { loadSlippageCompliance } from '@/lib/reputation/slippage-compliance-loader';
import type { SlippageComplianceWindow } from '@/lib/reputation/slippage-compliance';

export const runtime = 'nodejs';

const VALID_WINDOWS: readonly string[] = ['30', '90', 'all'];

/**
 * GET /api/v1/slippage-compliance — public endpoint for slippage compliance metrics.
 *
 * Query params:
 * - window: '30' | '90' | 'all' (default '30')
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(
    request,
    { bucket: 'v1.slippage-compliance', maxRequests: 60, scope: 'quotes:read' },
    async (ctx) => {
      const url = new URL(request.url);
      const windowParam = url.searchParams.get('window') ?? '30';

      if (!VALID_WINDOWS.includes(windowParam)) {
        return ctx.error('validation_error', 'window must be 30, 90, or all', 400);
      }

      const window: SlippageComplianceWindow =
        windowParam === 'all' ? 'all' : (Number(windowParam) as 30 | 90);

      const compliance = await loadSlippageCompliance(window);
      if (!compliance) {
        return ctx.error(
          'store_unavailable',
          'Reputation or slippage breach store is not available',
          503
        );
      }

      return {
        status: 200,
        body: compliance,
        headers: { 'Cache-Control': 'public, max-age=300' },
      };
    }
  );
}
