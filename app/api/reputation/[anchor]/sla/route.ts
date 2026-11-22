export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { ANCHORS } from '@/constants/anchors';
import { withRequestLogger } from '@/lib/logger';
import { enforceRateLimit } from '@/lib/api/response';
import { getReputationStore, ReputationStoreUnavailableError } from '@/lib/reputation/store';
import {
  buildExecutionSlaReport,
  ExecutionSlaReportSchema,
} from '@/lib/reputation/execution-sla';
import type { ApiError } from '@/types';
import type { OutcomeLogRow } from '@/types/reputation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ anchor: string }> | { anchor: string } }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.sla', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.sla',
      maxRequests: 120,
    });
    if (limited) return limited;

    const { anchor: anchorId } = await params;
    const anchor = ANCHORS.find((a) => a.id === anchorId);
    if (!anchor) {
      logger.warn({ event: 'anchor_not_found', anchorId });
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: `Unknown anchor: ${anchorId}` },
        { status: 404 }
      );
    }

    const corridor = request.nextUrl.searchParams.get('corridor') || undefined;
    if (corridor && !anchor.corridors.includes(corridor)) {
      logger.warn({ event: 'invalid_corridor', anchorId, corridor });
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: `Anchor ${anchorId} does not serve corridor ${corridor}`,
        },
        { status: 400 }
      );
    }

    let rows: OutcomeLogRow[] = [];
    try {
      rows = await getReputationStore().query({ anchorId, direction: 'withdraw' });
    } catch (err) {
      if (err instanceof ReputationStoreUnavailableError) {
        rows = [];
      } else {
        throw err;
      }
    }

    // Unattested rows are ignored
    rows = rows.filter((r) => r.attested);

    const report = buildExecutionSlaReport(
      rows,
      anchorId,
      corridor ? { corridor } : undefined
    );

    logger.info({
      event: 'execution_sla_report',
      anchorId,
      corridor,
      sampleSize: report.overall.sla.sampleSize,
    });

    return NextResponse.json(ExecutionSlaReportSchema.parse(report), { status: 200 });
  });
}
