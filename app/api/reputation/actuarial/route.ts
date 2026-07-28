import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import {
  buildActuarialProgressReport,
  observationFromOutcome,
  observationFromProbe,
  type ActuarialObservation,
} from '@/lib/reputation/actuarial';

export const runtime = 'nodejs';

/**
 * GET /api/reputation/actuarial — settlement-SLA actuarial accumulation (#813).
 *
 * Derives observations from the outcome and probe logs (cross-referenced by
 * intentHash / probe domain) and reports progress toward the ~10k launch
 * threshold, mirroring the 90-day probe-coverage gate.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.actuarial', async (logger) => {
    const store = getReputationStore();
    const [outcomes, probes] = await Promise.all([store.query(), store.queryProbeSamples()]);

    const observations: ActuarialObservation[] = [
      ...outcomes.map(observationFromOutcome),
      ...probes.map(observationFromProbe).filter((o): o is ActuarialObservation => o !== null),
    ];

    const report = buildActuarialProgressReport(observations);
    logger.info({
      event: 'actuarial_progress_report',
      total: report.total,
      settlements: report.settlements,
      thresholdMet: report.thresholdMet,
    });
    return NextResponse.json(report);
  });
}
