import { NextRequest, NextResponse } from 'next/server';
import { ANCHORS } from '@/constants/anchors';
import {
  anchorProbeDomains,
  buildProbeCoverageReport,
  type ProbeCoverageSample,
} from '@/lib/reputation/aggregate';
import { withRequestLogger } from '@/lib/logger';
import { tryGetReputationStore } from '@/lib/reputation/store';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';

/** GET /api/reputation/probe-coverage — 90-day probe-accumulation progress JSON. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.probe-coverage', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.probe-coverage',
      maxRequests: 60,
    });
    if (limited) return limited;

    // Degrade to a zero-coverage report when no durable store is configured
    // rather than 500ing — mirrors the leaderboard route.
    const store = tryGetReputationStore();
    const rows = store ? await store.queryProbeSamples(undefined, { kind: 'uptime' }) : [];
    const samplesByDomain = new Map<string, ProbeCoverageSample[]>();
    for (const row of rows) {
      const list = samplesByDomain.get(row.domain) ?? [];
      list.push({ probedAt: row.probedAt, kind: row.kind });
      samplesByDomain.set(row.domain, list);
    }

    const report = buildProbeCoverageReport(samplesByDomain, anchorProbeDomains(ANCHORS));
    logger.info({
      event: 'probe_coverage_report',
      daysUntilFleetThreshold: report.daysUntilFleetThreshold,
      fleetThresholdMet: report.fleetThresholdMet,
      anchorCount: report.anchors.length,
    });
    return NextResponse.json(report);
  });
}
