/**
 * Shared probe-coverage loading (#786).
 *
 * `buildProbeCoverageReport` in `./aggregate` is pure — it takes samples and
 * returns a report. Getting the samples out of a store is the part that had
 * started to duplicate: the CLI report did it inline, and the publish gate
 * needs exactly the same thing. One copy, here.
 */

import { ANCHORS } from '@/constants/anchors';
import {
  anchorProbeDomains,
  buildProbeCoverageReport,
  type ProbeCoverageReport,
  type ProbeCoverageSample,
} from './aggregate';
import type { ReputationStore } from './store';

/**
 * Groups uptime probe samples by domain, the shape
 * `buildProbeCoverageReport` expects.
 *
 * Only `kind: 'uptime'` counts toward coverage — a latency or drift sample says
 * something about an anchor that answered, not about whether it was observed.
 */
export async function loadProbeSamplesByDomain(
  store: ReputationStore
): Promise<Map<string, ProbeCoverageSample[]>> {
  const rows = await store.queryProbeSamples(undefined, { kind: 'uptime' });
  const byDomain = new Map<string, ProbeCoverageSample[]>();
  for (const row of rows) {
    const list = byDomain.get(row.domain) ?? [];
    list.push({ probedAt: row.probedAt, kind: row.kind });
    byDomain.set(row.domain, list);
  }
  return byDomain;
}

/**
 * Full coverage report for the registered fleet, read from `store`.
 *
 * The returned `ProbeCoverageReport` structurally satisfies the publisher
 * package's `ProbeCoverageSummary`, so it can be handed to the publish gate
 * without an adapter.
 */
export async function loadProbeCoverageReport(
  store: ReputationStore,
  options: { now?: Date } = {}
): Promise<ProbeCoverageReport> {
  const samplesByDomain = await loadProbeSamplesByDomain(store);
  return buildProbeCoverageReport(samplesByDomain, anchorProbeDomains(ANCHORS), {
    ...(options.now ? { now: options.now } : {}),
  });
}
