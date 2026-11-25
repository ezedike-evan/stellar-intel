export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/api/cron-auth';
import { withRequestLogger } from '@/lib/logger';
import { getDisputeStore } from '@/lib/reputation/disputes';
import { getAdjudicationLog } from '@/lib/reputation/adjudication-log';
import { getRefundStore } from '@/lib/refunds/store';
import { escalateOverdueDisputes } from '@/lib/reputation/dispute-sweep';
import { openDisputesForOverdueRefunds } from '@/lib/refunds/escalate';

async function handleSweep(request: NextRequest): Promise<NextResponse> {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  return withRequestLogger(request, 'api.reputation.dispute_sweep', async (logger) => {
    const disputes = getDisputeStore();
    const log = getAdjudicationLog();
    const refunds = getRefundStore();

    const now = new Date();
    const disputeRes = await escalateOverdueDisputes({ disputes, log, now });
    const refundRes = await openDisputesForOverdueRefunds({ refunds, disputes, log, now });

    logger.info({
      event: 'dispute_sweep_completed',
      scanned: disputeRes.scanned,
      escalated: disputeRes.escalated,
      refundDisputesOpened: refundRes.opened,
    });

    return NextResponse.json({
      ok: true,
      scanned: disputeRes.scanned,
      escalated: disputeRes.escalated,
      refundDisputesOpened: refundRes.opened,
      sweptAt: now.toISOString(),
    });
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleSweep(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleSweep(request);
}
