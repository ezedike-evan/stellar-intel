/**
 * SDF Anchor Directory contribution export (#796).
 *
 * SDF's Anchor Directory (anchors.stellar.org) has no published ingestion API
 * or submission schema for third-party health data — its "Attestation of
 * Reserves" section has read "coming soon" since the directory's 2023 relaunch,
 * and listings are otherwise maintained by contacting each anchor's team
 * directly (see docs/anchor-directory-contribution.md for the research trail).
 *
 * Until SDF opens a channel, this module turns our existing health signals
 * (the nightly validator's `constants/anchor-health.json` ledger, plus uptime
 * and quote-latency probe samples once #785 lands) into a portable,
 * self-describing JSON export — attachable to a manual submission today, and
 * reusable unchanged if SDF later publishes a real ingestion format.
 */

import type { Anchor } from '@/types';
import type { ProbeLedgerRow } from '@/types/reputation';
import type { AnchorHealth } from '@/lib/stellar/anchors';
import {
  reachabilityScore,
  averageLatencyMs,
  quoteLatencyPercentiles,
  type ProbeSample,
  type ProbeSampleStore,
} from './probe';

/** Bumped on any incompatible shape change; SDF has not assigned us a schema to track. */
export const SDF_EXPORT_SCHEMA_VERSION = '0.1.0-candidate';

export type SdfHealthStatus = 'healthy' | 'degraded' | 'unknown';

export interface SdfQuoteLatency {
  p50Ms: number;
  p95Ms: number;
  sampleCount: number;
}

export interface SdfAnchorHealthEntry {
  anchorId: string;
  name: string;
  homeDomain: string;
  serviceDomain: string | null;
  seps: string[];
  corridors: string[];
  health: {
    status: SdfHealthStatus;
    lastCheckedAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    /** Fraction [0, 1] of uptime probes that were reachable, over the retained probe window. Null with no samples yet. */
    uptime: number | null;
    /** Mean latency (ms) across reachable uptime probes. Null with no reachable samples. */
    avgLatencyMs: number | null;
    /** Per-corridor SEP-38 quote-latency percentiles, keyed by corridor ID. Empty until quote probes accumulate. */
    quoteLatencyByCorridor: Record<string, SdfQuoteLatency>;
  };
}

export interface SdfAnchorDirectoryExport {
  schemaVersion: string;
  generatedAt: string;
  source: string;
  note: string;
  anchors: SdfAnchorHealthEntry[];
}

/** Adapts flat DB probe rows into the `ProbeSampleStore` shape the probe.ts readers expect. */
function toProbeSampleStore(rows: readonly ProbeLedgerRow[]): ProbeSampleStore {
  const samples: ProbeSample[] = rows
    .map((r) => ({
      domain: r.domain,
      reachable: r.reachable,
      latencyMs: r.latencyMs,
      at: Date.parse(r.probedAt),
      failureType: r.failureType,
      ...(r.error !== null ? { error: r.error } : {}),
      ...(r.corridor !== null ? { corridor: r.corridor } : {}),
    }))
    .sort((a, b) => a.at - b.at);

  return {
    record() {
      throw new Error('sdfExport probe store is read-only');
    },
    samples(domain) {
      return domain === undefined ? samples : samples.filter((s) => s.domain === domain);
    },
  };
}

function statusFor(health: AnchorHealth | undefined): SdfHealthStatus {
  if (health === undefined || health.lastCheckedAt === null) return 'unknown';
  return health.degraded ? 'degraded' : 'healthy';
}

/**
 * Builds the candidate SDF Anchor Directory export from the anchor registry,
 * the nightly health ledger, and (once populated) uptime/quote probe rows.
 * Pure — takes every input explicitly so it can be unit-tested without a DB.
 */
export function buildSdfAnchorDirectoryExport(
  anchors: readonly Anchor[],
  healthById: ReadonlyMap<string, AnchorHealth>,
  probeRowsByDomain: ReadonlyMap<string, readonly ProbeLedgerRow[]>,
  now: () => Date = () => new Date()
): SdfAnchorDirectoryExport {
  const entries: SdfAnchorHealthEntry[] = anchors.map((anchor) => {
    const domain = anchor.serviceDomain ?? anchor.homeDomain;
    const health = healthById.get(anchor.id);
    const rows = probeRowsByDomain.get(domain) ?? [];
    const uptimeStore = toProbeSampleStore(rows.filter((r) => r.kind === 'uptime'));
    const quoteStore = toProbeSampleStore(rows.filter((r) => r.kind === 'quote'));

    const quoteLatencyByCorridor: Record<string, SdfQuoteLatency> = {};
    for (const corridorId of anchor.corridors) {
      const percentiles = quoteLatencyPercentiles(domain, corridorId, quoteStore);
      if (percentiles) quoteLatencyByCorridor[corridorId] = percentiles;
    }

    return {
      anchorId: anchor.id,
      name: anchor.name,
      homeDomain: anchor.homeDomain,
      serviceDomain: anchor.serviceDomain ?? null,
      seps: anchor.seps ? [...anchor.seps] : [],
      corridors: [...anchor.corridors],
      health: {
        status: statusFor(health),
        lastCheckedAt: health?.lastCheckedAt ?? null,
        lastStatus: health?.lastStatus ?? null,
        lastError: health?.lastError ?? null,
        consecutiveFailures: health?.consecutiveFailures ?? 0,
        uptime: reachabilityScore(domain, uptimeStore),
        avgLatencyMs: averageLatencyMs(domain, uptimeStore),
        quoteLatencyByCorridor,
      },
    };
  });

  return {
    schemaVersion: SDF_EXPORT_SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    source: 'https://github.com/ezedike-evan/stellar-intel',
    note:
      'SDF has not published an Anchor Directory ingestion API — this is a candidate ' +
      'export shape for manual submission, not an SDF-endorsed schema. See ' +
      'docs/anchor-directory-contribution.md.',
    anchors: entries,
  };
}
