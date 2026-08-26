import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ANCHORS } from '@/constants/anchors';
import {
  anchorProbeDomains,
  buildProbeCoverageReport,
  type ProbeCoverageReport,
  type ProbeCoverageSample,
} from '@/lib/reputation/aggregate';
import { tryGetReputationStore } from '@/lib/reputation/store';

export const PROBE_COVERAGE_TOOL_NAME = 'intel.probe.coverage';

/**
 * Same report as GET /api/reputation/probe-coverage for the current moment:
 * fleetThresholdMet, daysUntilFleetThreshold, and per-anchor continuous days.
 */
export async function getProbeCoverage(): Promise<ProbeCoverageReport> {
  const store = tryGetReputationStore();
  const rows = store ? await store.queryProbeSamples(undefined, { kind: 'uptime' }) : [];
  const samplesByDomain = new Map<string, ProbeCoverageSample[]>();
  for (const row of rows) {
    const list = samplesByDomain.get(row.domain) ?? [];
    list.push({ probedAt: row.probedAt, kind: row.kind });
    samplesByDomain.set(row.domain, list);
  }
  return buildProbeCoverageReport(samplesByDomain, anchorProbeDomains(ANCHORS));
}

export function registerProbeCoverageTool(server: McpServer): void {
  server.registerTool(
    PROBE_COVERAGE_TOOL_NAME,
    {
      title: 'Probe coverage',
      description:
        'Whether probe history is trustworthy yet: fleetThresholdMet, daysUntilFleetThreshold, ' +
        'and per-anchor continuous days. Same payload as GET /api/reputation/probe-coverage.',
      inputSchema: {},
    },
    async () => {
      try {
        const report = await getProbeCoverage();
        return {
          content: [{ type: 'text', text: JSON.stringify(report) }],
          structuredContent: report,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
    }
  );
}
