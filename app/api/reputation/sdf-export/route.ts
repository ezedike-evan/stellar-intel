import { NextRequest, NextResponse } from 'next/server';
import { ANCHORS, getAnchorHealth, type AnchorHealth } from '@/lib/stellar/anchors';
import { buildSdfAnchorDirectoryExport } from '@/lib/reputation/sdfExport';
import { withRequestLogger } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import type { ProbeLedgerRow } from '@/types/reputation';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * GET /api/reputation/sdf-export — candidate export for SDF's Anchor
 * Directory (#796). SDF has no published ingestion API, so this is a
 * self-describing JSON shape suitable for manual submission today; see
 * docs/anchor-directory-contribution.md.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.sdf-export', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.sdf-export',
      maxRequests: 30,
    });
    if (limited) return limited;

    const store = getReputationStore();
    const rows = await store.queryProbeSamples();

    const probeRowsByDomain = new Map<string, ProbeLedgerRow[]>();
    for (const row of rows) {
      const list = probeRowsByDomain.get(row.domain) ?? [];
      list.push(row);
      probeRowsByDomain.set(row.domain, list);
    }

    const healthById = new Map<string, AnchorHealth>();
    for (const anchor of ANCHORS) {
      const health = getAnchorHealth(anchor.id);
      if (health) healthById.set(anchor.id, health);
    }

    const report = buildSdfAnchorDirectoryExport(ANCHORS, healthById, probeRowsByDomain);
    logger.info({
      event: 'sdf_export_generated',
      anchorCount: report.anchors.length,
      schemaVersion: report.schemaVersion,
    });
    return NextResponse.json(report);
  });
}
