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
import { getCorridorById } from '@/lib/stellar/anchors';
import { assertSep38Capable, getSep38Price } from '@/lib/stellar/sep38';
import { DRIFT_THRESHOLD_PERCENT, isDrifted } from './thresholds';
import { ANCHORS } from '@/constants/anchors';
import type { ProbeFailureType } from '@/types/reputation';
import type { Anchor } from '@/types';

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
  /** Classified failure reason; null when reachable. */
  failureType?: ProbeFailureType | null;
  /** Failure reason when `reachable` is false. */
  error?: string;
  /** Corridor ID this sample measured; present on quote-latency samples, absent on uptime samples. */
  corridor?: string;
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
 * Classify a probe failure into a bucket: dns, tls, http, timeout, or unknown.
 * DNS failures surface as ENOTFOUND / ENOTINFO / EAI_AGAIN; TLS as
 * UNABLE_TO_VERIFY / CERT / SSL; timeout as AbortError or ETIMEDOUT; everything
 * else is treated as an HTTP-level failure when the message contains an HTTP
 * status code, or falls back to "unknown".
 */
export function classifyFailure(error: string): ProbeFailureType {
  const lower = error.toLowerCase();

  if (lower.includes('enotfound') || lower.includes('enotinfo') || lower.includes('eai_again')) {
    return 'dns';
  }
  if (
    lower.includes('unable_to_verify') ||
    lower.includes('cert') ||
    lower.includes('ssl') ||
    lower.includes('tls') ||
    lower.includes('err_cert')
  ) {
    return 'tls';
  }
  if (lower.includes('abort') || lower.includes('etimedout') || lower.includes('timeout')) {
    return 'timeout';
  }
  if (/http\s*\d{3}/.test(lower) || lower.includes('status')) {
    return 'http';
  }
  return 'unknown';
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
  let failureType: ProbeFailureType | null = null;
  try {
    const result = await fetchToml(domain);
    reachable = result.ok;
    if (!result.ok) {
      error = result.error ?? 'unreachable';
      failureType = classifyFailure(error);
    }
  } catch (err) {
    reachable = false;
    error = err instanceof Error ? err.message : String(err);
    failureType = classifyFailure(error);
    logger.warn({ event: 'probe.error', domain, error, failureType }, 'probe caught an exception');
  }

  const end = now();
  const sample: ProbeSample = {
    domain,
    reachable,
    latencyMs: Math.max(0, end - start),
    at: end,
    failureType,
    ...(error !== undefined ? { error } : {}),
  };
  logger.info(
    {
      event: 'probe.sample',
      domain,
      reachable,
      latencyMs: sample.latencyMs,
      failureType,
      error,
    },
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

/**
 * Probe every registered anchor from `constants/anchors.ts` once. Uses each
 * anchor's `serviceDomain` when available, falling back to `homeDomain`.
 * Returns the samples keyed by anchor id.
 */
export async function probeAllAnchors(
  store: ProbeSampleStore,
  deps?: ProbeDeps
): Promise<Map<string, ProbeSample>> {
  const domains = ANCHORS.map((a) => a.serviceDomain ?? a.homeDomain);
  logger.info(
    { event: 'probe.all.start', anchorCount: ANCHORS.length },
    'probing all registered anchors'
  );
  const samples = await runProbe(domains, store, deps);
  const byAnchor = new Map<string, ProbeSample>();
  for (let i = 0; i < ANCHORS.length; i++) {
    const anchor = ANCHORS[i];
    const sample = samples[i];
    if (anchor && sample) {
      byAnchor.set(anchor.id, sample);
    }
  }
  return byAnchor;
}

// ─── Quote-drift probe (Issue #D006) ───────────────────────────────────────────
//
// Compares each anchor's quoted rate, for a fixed reference corridor/amount,
// against the cross-anchor median. An anchor whose rate deviates beyond a
// configurable threshold (default 3%, see `lib/reputation/thresholds.ts`) is
// flagged — a stale cache or a manipulated quote both show up as drift — but
// never auto-excluded; that decision is left to a human or a later policy.

/** One anchor's indicative rate for the reference corridor/amount. */
export interface AnchorQuote {
  anchorId: string;
  /** Indicative rate (buy amount per unit sold), from SEP-38 GET /price. */
  rate: number;
}

/** One anchor's quote compared against the cross-anchor median. */
export interface DriftSample {
  anchorId: string;
  corridor: string;
  rate: number;
  medianRate: number;
  /** Signed percentage deviation from the median; positive means above median. */
  deviationPercent: number;
  /** True when `|deviationPercent|` exceeds the configured drift threshold. */
  flagged: boolean;
  /** Epoch milliseconds when the comparison was made. */
  at: number;
}

/** Persistence sink for drift samples — mirrors `ProbeSampleStore`. */
export interface DriftSampleStore {
  /** Append one sample. */
  record(sample: DriftSample): void;
  /** All samples, optionally filtered to a single anchor, oldest first. */
  samples(anchorId?: string): DriftSample[];
}

/** In-memory drift sample store — the default sink, and the one used in tests. */
export class InMemoryDriftStore implements DriftSampleStore {
  private readonly rows: DriftSample[] = [];

  record(sample: DriftSample): void {
    this.rows.push({ ...sample });
  }

  samples(anchorId?: string): DriftSample[] {
    const rows = anchorId ? this.rows.filter((r) => r.anchorId === anchorId) : this.rows;
    return rows.map((r) => ({ ...r })).sort((a, b) => a.at - b.at);
  }
}

/** Median of a numeric array (average of the two middle values for even-length input). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Compares each anchor's quoted rate against the cross-anchor median for the
 * same corridor and flags anchors that deviate beyond `thresholdPercent`.
 * Pure and network-free, so the acceptance-criteria fixture ("a quote 10%
 * off-median is flagged") can be verified without a probe cycle.
 */
export function detectQuoteDrift(
  quotes: readonly AnchorQuote[],
  corridorId: string,
  thresholdPercent: number = DRIFT_THRESHOLD_PERCENT,
  now: () => number = Date.now
): DriftSample[] {
  const medianRate = median(quotes.map((q) => q.rate));
  const at = now();
  return quotes.map((q) => {
    const deviationPercent = medianRate !== 0 ? ((q.rate - medianRate) / medianRate) * 100 : 0;
    return {
      anchorId: q.anchorId,
      corridor: corridorId,
      rate: q.rate,
      medianRate,
      deviationPercent,
      flagged: isDrifted(deviationPercent, thresholdPercent),
      at,
    };
  });
}

/** The minimal outcome of a reference-rate fetch the drift probe depends on. */
export interface RateProbeResult {
  ok: boolean;
  rate?: number;
  error?: string;
}

/** Injectable dependencies for the quote-drift probe. */
export interface QuoteDriftDeps {
  /** Fetches an anchor's indicative rate for the reference corridor/amount. Defaults to a real GET /price call. */
  fetchRate?: (anchor: Anchor, corridorId: string, amount: string) => Promise<RateProbeResult>;
  /** Monotonic-ish millisecond clock. Defaults to `Date.now`. */
  now?: () => number;
}

async function defaultFetchRate(
  anchor: Anchor,
  corridorId: string,
  amount: string
): Promise<RateProbeResult> {
  const domain = anchor.serviceDomain ?? anchor.homeDomain;
  const tomlResult = await resolveToml(domain);
  if (!tomlResult.ok) {
    return { ok: false, error: tomlResult.error };
  }

  let quoteServer: string;
  try {
    quoteServer = assertSep38Capable(tomlResult.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const corridor = getCorridorById(corridorId);
  try {
    const price = await getSep38Price({
      quoteServer,
      sell_asset: `stellar:${anchor.assetCode}:${anchor.assetIssuer}`,
      buy_asset: `iso4217:${corridor.to}`,
      sell_amount: amount,
      context: 'sep31',
    });
    const rateValue = price.total_price ?? price.price;
    const rate = Number(rateValue);
    if (!Number.isFinite(rate) || rate <= 0) {
      return { ok: false, error: `invalid rate in SEP-38 /price response: "${rateValue}"` };
    }
    return { ok: true, rate };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function resolveDriftDeps(deps?: QuoteDriftDeps): Required<QuoteDriftDeps> {
  return {
    fetchRate: deps?.fetchRate ?? defaultFetchRate,
    now: deps?.now ?? Date.now,
  };
}

/**
 * Runs one quote-drift probe cycle: fetches every anchor's indicative rate for
 * a fixed reference corridor/amount, computes the cross-anchor median, and
 * flags anchors whose rate deviates beyond the configured threshold. Anchors
 * that fail to quote are skipped from the comparison (that's a reachability
 * concern for the uptime probe, not a drift signal) and are never recorded.
 */
export async function probeQuoteDrift(
  anchors: readonly Anchor[],
  corridorId: string,
  amount: string,
  store: DriftSampleStore,
  deps?: QuoteDriftDeps,
  thresholdPercent: number = DRIFT_THRESHOLD_PERCENT
): Promise<DriftSample[]> {
  const { fetchRate, now } = resolveDriftDeps(deps);
  logger.info(
    { event: 'probe.drift.start', anchorCount: anchors.length, corridor: corridorId, amount },
    'starting quote-drift probe run'
  );

  const results = await Promise.all(
    anchors.map(async (anchor) => ({ anchor, result: await fetchRate(anchor, corridorId, amount) }))
  );

  const quotes: AnchorQuote[] = [];
  let skipped = 0;
  for (const { anchor, result } of results) {
    if (result.ok && result.rate !== undefined) {
      quotes.push({ anchorId: anchor.id, rate: result.rate });
    } else {
      skipped++;
      logger.warn(
        {
          event: 'probe.drift.skip',
          anchorId: anchor.id,
          corridor: corridorId,
          error: result.error,
        },
        'anchor skipped from drift comparison (unreachable)'
      );
    }
  }

  const samples = detectQuoteDrift(quotes, corridorId, thresholdPercent, now);
  for (const sample of samples) {
    store.record(sample);
  }

  logger.info(
    {
      event: 'probe.drift.complete',
      corridor: corridorId,
      compared: samples.length,
      skipped,
      flagged: samples.filter((s) => s.flagged).length,
    },
    'quote-drift probe run complete'
  );

  return samples;
}

// ─── Quote-latency probe (Issue #D005) ─────────────────────────────────────────
//
// Times the SEP-38 quote round-trip per anchor per corridor, independent of the
// uptime probe above, so a "reachable but slow" anchor is distinguishable from
// one that's simply down. Uses the indicative GET /price endpoint (no SEP-10
// JWT required) since a probe cycle has no authenticated session to reuse.

/** The minimal outcome of a SEP-38 quote round-trip the probe depends on. */
export interface QuoteProbeResult {
  ok: boolean;
  error?: string;
}

/** Injectable dependencies for the quote-latency probe. */
export interface QuoteProbeDeps {
  /** Times a SEP-38 quote round-trip for an anchor+corridor. Defaults to a real GET /price call. */
  fetchQuote?: (anchor: Anchor, corridorId: string) => Promise<QuoteProbeResult>;
  /** Monotonic-ish millisecond clock. Defaults to `Date.now`. */
  now?: () => number;
}

async function defaultFetchQuote(anchor: Anchor, corridorId: string): Promise<QuoteProbeResult> {
  const domain = anchor.serviceDomain ?? anchor.homeDomain;
  const tomlResult = await resolveToml(domain);
  if (!tomlResult.ok) {
    return { ok: false, error: tomlResult.error };
  }

  let quoteServer: string;
  try {
    quoteServer = assertSep38Capable(tomlResult.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const corridor = getCorridorById(corridorId);
  try {
    await getSep38Price({
      quoteServer,
      sell_asset: `stellar:${anchor.assetCode}:${anchor.assetIssuer}`,
      buy_asset: `iso4217:${corridor.to}`,
      sell_amount: '100',
      context: 'sep31',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function resolveQuoteDeps(deps?: QuoteProbeDeps): Required<QuoteProbeDeps> {
  return {
    fetchQuote: deps?.fetchQuote ?? defaultFetchQuote,
    now: deps?.now ?? Date.now,
  };
}

/**
 * Probe one anchor+corridor's SEP-38 quote round-trip, timing the full request
 * and recording one sample. Network/transport/capability failures are caught
 * and recorded as unreachable rather than thrown, matching `probeAnchor`.
 */
export async function probeQuoteLatency(
  anchor: Anchor,
  corridorId: string,
  store: ProbeSampleStore,
  deps?: QuoteProbeDeps
): Promise<ProbeSample> {
  const { fetchQuote, now } = resolveQuoteDeps(deps);
  const domain = anchor.serviceDomain ?? anchor.homeDomain;
  const start = now();

  let reachable = false;
  let error: string | undefined;
  let failureType: ProbeFailureType | null = null;
  try {
    const result = await fetchQuote(anchor, corridorId);
    reachable = result.ok;
    if (!result.ok) {
      error = result.error ?? 'quote unavailable';
      failureType = classifyFailure(error);
    }
  } catch (err) {
    reachable = false;
    error = err instanceof Error ? err.message : String(err);
    failureType = classifyFailure(error);
    logger.warn(
      { event: 'probe.quote.error', domain, corridor: corridorId, error, failureType },
      'quote probe caught an exception'
    );
  }

  const end = now();
  const sample: ProbeSample = {
    domain,
    corridor: corridorId,
    reachable,
    latencyMs: Math.max(0, end - start),
    at: end,
    failureType,
    ...(error !== undefined ? { error } : {}),
  };
  logger.info(
    {
      event: 'probe.quote.sample',
      domain,
      corridor: corridorId,
      reachable,
      latencyMs: sample.latencyMs,
      failureType,
      error,
    },
    'quote-latency sample recorded'
  );
  store.record(sample);
  return sample;
}

/**
 * Runs the quote-latency probe for every anchor across all of its configured
 * corridors, concurrently. Defaults to the registered fleet in
 * `constants/anchors.ts`; a different anchor list may be injected for tests.
 */
export async function probeAllAnchorQuotes(
  store: ProbeSampleStore,
  deps?: QuoteProbeDeps,
  anchors: readonly Anchor[] = ANCHORS
): Promise<ProbeSample[]> {
  const jobs = anchors.flatMap((anchor) =>
    anchor.corridors.map((corridorId) => ({ anchor, corridorId }))
  );
  logger.info(
    { event: 'probe.quote.all.start', jobCount: jobs.length },
    'starting quote-latency probe run'
  );
  const samples = await Promise.all(
    jobs.map(({ anchor, corridorId }) => probeQuoteLatency(anchor, corridorId, store, deps))
  );
  const reachable = samples.filter((s) => s.reachable).length;
  logger.info(
    {
      event: 'probe.quote.all.complete',
      total: samples.length,
      reachable,
      unreachable: samples.length - reachable,
    },
    'quote-latency probe run complete'
  );
  return samples;
}

/**
 * p50/p95 latency for an anchor+corridor over a rolling window of its most
 * recent *reachable* quote samples (default window: last 20). Distinct from
 * `averageLatencyMs`, which mixes all corridors together — this isolates one
 * corridor so a single degraded pair doesn't get averaged away. Returns `null`
 * when there are no reachable samples for the pair.
 */
export function quoteLatencyPercentiles(
  domain: string,
  corridorId: string,
  store: ProbeSampleStore,
  windowSize = 20
): { p50Ms: number; p95Ms: number; sampleCount: number } | null {
  const reachable = store.samples(domain).filter((r) => r.corridor === corridorId && r.reachable);
  const windowed = reachable.slice(Math.max(0, reachable.length - windowSize));
  if (windowed.length === 0) return null;

  const sorted = windowed.map((r) => r.latencyMs).sort((a, b) => a - b);
  const rank = (p: number): number => {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)]!;
  };
  return { p50Ms: rank(50), p95Ms: rank(95), sampleCount: windowed.length };
}
