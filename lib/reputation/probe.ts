/**
 * Per-anchor health probe (uptime / latency) — reputation bootstrap (#B046).
 *
 * A lightweight probe that records `stellar.toml` reachability and latency per
 * anchor, producing the raw samples that bootstrap reputation signals before we
 * have enough real off-ramp outcomes to score on.
 *
 * It reuses the same anchor-fetch helper the survey and the runtime use
 * (`resolveToml` from `lib/stellar/sep1`), so reachability matches what callers
 * actually experience. Both the fetcher and the clock are injectable so the
 * probe is deterministic under test and never hits the network there.
 */

import { getLogger } from '@/lib/logger';
import { resolveToml } from '@/lib/stellar/sep1';

const logger = getLogger('reputation/probe');

/** A single reachability/latency observation for one anchor. */
export interface ProbeSample {
  /** Anchor home domain that was probed. */
  domain: string;
  /** True if the anchor's stellar.toml resolved successfully. */
  reachable: boolean;
  /** Round-trip time of the probe in milliseconds. */
  latencyMs: number;
  /** Epoch milliseconds when the sample was taken. */
  at: number;
  /** Failure reason when `reachable` is false. */
  error?: string;
}

/** Persistence sink for probe samples. */
export interface ProbeSampleStore {
  /** Append one sample. */
  record(sample: ProbeSample): void;
  /** All samples, optionally filtered to a single domain, oldest first. */
  samples(domain?: string): ProbeSample[];
}

/**
 * In-memory sample store — the default sink, and the one used in tests. A
 * durable backend (SQLite/Postgres, mirroring `ReputationStore`) can implement
 * the same interface later without touching the probe runner.
 */
export class InMemoryProbeStore implements ProbeSampleStore {
  private readonly rows: ProbeSample[] = [];

  record(sample: ProbeSample): void {
    this.rows.push({ ...sample });
  }

  samples(domain?: string): ProbeSample[] {
    const rows = domain ? this.rows.filter((r) => r.domain === domain) : this.rows;
    return rows.map((r) => ({ ...r })).sort((a, b) => a.at - b.at);
  }
}

/** The minimal slice of a TOML fetch result the probe depends on. */
export interface TomlProbeResult {
  ok: boolean;
  error?: string;
}

/** Injectable dependencies (defaulted to the real fetch helper + wall clock). */
export interface ProbeDeps {
  /** Anchor TOML fetcher. Defaults to `resolveToml` from lib/stellar/sep1. */
  fetchToml?: (domain: string) => Promise<TomlProbeResult>;
  /** Monotonic-ish millisecond clock. Defaults to `Date.now`. */
  now?: () => number;
}

function resolveDeps(deps?: ProbeDeps): Required<ProbeDeps> {
  return {
    fetchToml: deps?.fetchToml ?? ((domain) => resolveToml(domain)),
    now: deps?.now ?? Date.now,
  };
}

/**
 * Probe a single anchor: time its TOML fetch, record one sample, return it.
 * Network/transport failures are caught and recorded as unreachable rather than
 * thrown, so one dead anchor never aborts a fleet run.
 */
export async function probeAnchor(
  domain: string,
  store: ProbeSampleStore,
  deps?: ProbeDeps
): Promise<ProbeSample> {
  const { fetchToml, now } = resolveDeps(deps);
  const start = now();

  let reachable = false;
  let error: string | undefined;
  try {
    const result = await fetchToml(domain);
    reachable = result.ok;
    if (!result.ok) error = result.error ?? 'unreachable';
  } catch (err) {
    reachable = false;
    error = err instanceof Error ? err.message : String(err);
    logger.warn({ event: 'probe.error', domain, error }, 'probe caught an exception');
  }

  const end = now();
  const sample: ProbeSample = {
    domain,
    reachable,
    latencyMs: Math.max(0, end - start),
    at: end,
    ...(error !== undefined ? { error } : {}),
  };
  logger.info(
    { event: 'probe.sample', domain, reachable, latencyMs: sample.latencyMs, error },
    'probe sample recorded'
  );
  store.record(sample);
  return sample;
}

/**
 * Probe every domain once, recording a sample for each. Returns the samples in
 * the same order as `domains`. Anchors are probed concurrently.
 */
export async function runProbe(
  domains: readonly string[],
  store: ProbeSampleStore,
  deps?: ProbeDeps
): Promise<ProbeSample[]> {
  logger.info({ event: 'probe.run.start', domainCount: domains.length }, 'starting probe run');
  const samples = await Promise.all(domains.map((domain) => probeAnchor(domain, store, deps)));
  const reachable = samples.filter((s) => s.reachable).length;
  logger.info(
    {
      event: 'probe.run.complete',
      total: samples.length,
      reachable,
      unreachable: samples.length - reachable,
    },
    'probe run complete'
  );
  return samples;
}

/**
 * Reachability score for an anchor in `[0, 1]`: the fraction of its samples
 * that were reachable. A down anchor (failed probes) drives this below a
 * healthy anchor's, which is the signal reputation bootstraps on. Returns
 * `null` when there are no samples yet (unknown, distinct from "down").
 */
export function reachabilityScore(domain: string, store: ProbeSampleStore): number | null {
  const rows = store.samples(domain);
  if (rows.length === 0) return null;
  const up = rows.filter((r) => r.reachable).length;
  return up / rows.length;
}

/**
 * Mean latency (ms) across an anchor's *reachable* samples, or `null` if it has
 * never been reachable. Unreachable samples are excluded so a timeout doesn't
 * masquerade as fast.
 */
export function averageLatencyMs(domain: string, store: ProbeSampleStore): number | null {
  const reachable = store.samples(domain).filter((r) => r.reachable);
  if (reachable.length === 0) return null;
  const total = reachable.reduce((sum, r) => sum + r.latencyMs, 0);
  return total / reachable.length;
}
