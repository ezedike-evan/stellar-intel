import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { checkCronAuth } from '@/lib/api/cron-auth';
import { getAdjudicationLog } from '@/lib/reputation/adjudication-log';
import { getDisputeStore } from '@/lib/reputation/disputes';
import { escalateOverdueDisputes } from '@/lib/reputation/dispute-sweep';

export const runtime = 'nodejs';

// ─── GET|POST /api/reputation/dispute-sweep ────────────────────────────────────
//
// Triggered by GitHub Actions (.github/workflows/reputation-cron.yml). Moves
// disputes that sat at the anchor rung past its 72-hour deadline to maintainer
// review and records each move in the public adjudication log. No request body
// is needed because the work list comes from the dispute store.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  return withRequestLogger(request, 'api.reputation.dispute_sweep', async (logger) => {
    const result = await escalateOverdueDisputes({
      disputes: getDisputeStore(),
      log: getAdjudicationLog(),
    });
    logger.info({
      event: 'dispute_sweep_run',
      scanned: result.scanned,
      escalated: result.escalated,
    });
    return NextResponse.json(result);
  });
}

// Manual trigger parity for non-cron callers.
export const POST = GET;
