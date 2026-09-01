/**
 * @vitest-environment node
 *
 * intel.probe.coverage (#1046) — tool output matches GET /api/reputation/probe-coverage
 * for the same moment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/reputation/probe-coverage/route';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';
import type { ProbeLedgerRow } from '@/types/reputation';
import { getProbeCoverage } from '@/packages/mcp/src/tools/probe-coverage';
import { ANCHORS } from '@/constants/anchors';
import { anchorProbeDomains } from '@/lib/reputation/aggregate';

const NOW = new Date('2026-08-26T12:00:00.000Z');

// Derived, not hardcoded: an anchor's probe domain is its serviceDomain when it
// declares one and its homeDomain otherwise, so pinning a literal here silently
// stops seeding the anchor the moment its registry entry gains a serviceDomain.
const COWRIE_PROBE_DOMAIN = anchorProbeDomains(ANCHORS).find(
  (a) => a.anchorId === 'cowrie'
)!.domain;

function uptimeRow(domain: string, at: Date): ProbeLedgerRow {
  return {
    domain,
    kind: 'uptime',
    corridor: null,
    reachable: true,
    latencyMs: 40,
    failureType: null,
    error: null,
    probedAt: at.toISOString(),
  };
}

describe('intel.probe.coverage (#1046)', () => {
  afterEach(() => {
    vi.useRealTimers();
    _setReputationStore(null);
  });

  it('matches GET /api/reputation/probe-coverage at the same moment', async () => {
    const store = new InMemoryReputationStore();
    _setReputationStore(store);

    const today = new Date(NOW);
    const yesterday = new Date(NOW);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await store.recordProbeSample(uptimeRow(COWRIE_PROBE_DOMAIN, yesterday));
    await store.recordProbeSample(uptimeRow(COWRIE_PROBE_DOMAIN, today));

    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const res = await GET(new NextRequest('http://localhost/api/reputation/probe-coverage'));
    const restBody = await res.json();
    const toolBody = await getProbeCoverage();

    expect(res.status).toBe(200);
    expect(toolBody).toEqual(restBody);
    expect(toolBody.fleetThresholdMet).toBe(restBody.fleetThresholdMet);
    expect(toolBody.daysUntilFleetThreshold).toBe(restBody.daysUntilFleetThreshold);
    expect(
      toolBody.anchors.map((a) => ({ id: a.anchorId, continuousDays: a.continuousDays }))
    ).toEqual(
      restBody.anchors.map((a: { anchorId: string; continuousDays: number }) => ({
        id: a.anchorId,
        continuousDays: a.continuousDays,
      }))
    );

    const cowrie = toolBody.anchors.find((a) => a.anchorId === 'cowrie');
    expect(cowrie?.continuousDays).toBe(2);
  });
});
