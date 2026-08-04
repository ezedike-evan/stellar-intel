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
import { resolveToml, validateTomlIntegrity, type TomlResult } from '@/lib/stellar/sep1';
import { getCorridorById } from '@/lib/stellar/anchors';
import { assertSep38Capable, getSep38Price, getSep38Info } from '@/lib/stellar/sep38';
import {
  DEGRADE_AFTER_FAILURES,
  DOWN_AFTER_FAILURES,
  DRIFT_THRESHOLD_PERCENT,
  LATENCY_BUDGET_MS,
  healthStatusFor,
  isDegradingTransition,
  isDrifted,
  type AnchorHealthStatus,
} from './thresholds';
import { ANCHORS } from '@/constants/anchors';
import type { ProbeFailureType, ProbeKind, ProbeLedgerRow } from '@/types/reputation';
import type { Anchor, Sep1TomlData } from '@/types';

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

// ─── Issuer-mismatch probe (Issue #D004) ───────────────────────────────────────
//
// Compares an anchor's stellar.toml advertised issuer for its registered asset
// against the issuer its own live SEP-38 GET /info response returns for that
// same asset. The two are usually set from the same config and never drift,
// but if they ever do it means the anchor's live quote server is settling a
// look-alike asset under a different issuer than the one publicly advertised
// — a trust-critical signal distinct from routine unreachability, so it is
// recorded as its own probe dimension rather than folded into `uptime`.

/** Outcome of one issuer-mismatch check. */
export interface IssuerCheckResult {
  /** True when both the toml and the live SEP-38 /info issuer were resolved (whether or not they match). */
  ok: boolean;
  /** Issuer address from the anchor's stellar.toml CURRENCIES entry for its asset code; null if absent. */
  advertisedIssuer: string | null;
  /** Issuer address from the anchor's live SEP-38 /info assets list for the same asset code; null if absent. */
  actualIssuer: string | null;
  /** Set when `ok` is false — the reason the check could not complete. */
  error?: string;
}

/** Injectable dependencies for the issuer-mismatch probe. */
export interface IssuerMismatchDeps {
  /** Resolves an anchor's advertised vs. actual issuer. Defaults to a real toml + SEP-38 /info fetch. */
  checkIssuer?: (anchor: Anchor) => Promise<IssuerCheckResult>;
  /** Monotonic-ish millisecond clock. Defaults to `Date.now`. */
  now?: () => number;
}

async function defaultCheckIssuer(anchor: Anchor): Promise<IssuerCheckResult> {
  const domain = anchor.serviceDomain ?? anchor.homeDomain;
  const tomlResult = await resolveToml(domain);
  if (!tomlResult.ok) {
    return { ok: false, advertisedIssuer: null, actualIssuer: null, error: tomlResult.error };
  }

  const advertisedIssuer =
    tomlResult.data.CURRENCIES.find((c) => c.code === anchor.assetCode)?.issuer ?? null;

  let quoteServer: string;
  try {
    quoteServer = assertSep38Capable(tomlResult.data);
  } catch (err) {
    return {
      ok: false,
      advertisedIssuer,
      actualIssuer: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const info = await getSep38Info(quoteServer);
    const prefix = `stellar:${anchor.assetCode}:`;
    const match = info.assets.find((a) => a.asset.startsWith(prefix));
    const actualIssuer = match ? match.asset.slice(prefix.length) || null : null;
    return { ok: true, advertisedIssuer, actualIssuer };
  } catch (err) {
    return {
      ok: false,
      advertisedIssuer,
      actualIssuer: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveIssuerMismatchDeps(deps?: IssuerMismatchDeps): Required<IssuerMismatchDeps> {
  return {
    checkIssuer: deps?.checkIssuer ?? defaultCheckIssuer,
    now: deps?.now ?? Date.now,
  };
}

/**
 * Probe one anchor's issuer-mismatch check, recording exactly one sample.
 * `reachable: true` means the check completed and the advertised and actual
 * issuers matched; `reachable: false` covers both a genuine mismatch (a
 * `mismatch` failure type, distinguishable from network failures) and a
 * probe that could not complete (classified like the other probes).
 */
export async function probeIssuerMismatch(
  anchor: Anchor,
  store: ProbeSampleStore,
  deps?: IssuerMismatchDeps
): Promise<ProbeSample> {
  const { checkIssuer, now } = resolveIssuerMismatchDeps(deps);
  const domain = anchor.serviceDomain ?? anchor.homeDomain;
  const start = now();

  let result: IssuerCheckResult;
  try {
    result = await checkIssuer(anchor);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ event: 'probe.issuer.error', domain, error }, 'issuer probe caught an exception');
    result = { ok: false, advertisedIssuer: null, actualIssuer: null, error };
  }

  let reachable: boolean;
  let error: string | undefined;
  let failureType: ProbeFailureType | null = null;
  if (!result.ok) {
    reachable = false;
    error = result.error ?? 'issuer check unavailable';
    failureType = classifyFailure(error);
  } else if (result.advertisedIssuer !== null && result.advertisedIssuer === result.actualIssuer) {
    reachable = true;
  } else {
    reachable = false;
    failureType = 'mismatch';
    error = `issuer mismatch for ${anchor.assetCode}: advertised=${result.advertisedIssuer ?? 'none'} actual=${result.actualIssuer ?? 'none'}`;
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
    { event: 'probe.issuer.sample', domain, reachable, failureType, error },
    'issuer-mismatch sample recorded'
  );
  store.record(sample);
  return sample;
}

/**
 * Runs the issuer-mismatch probe for every registered anchor, concurrently.
 * Defaults to the registered fleet in `constants/anchors.ts`; a different
 * anchor list may be injected for tests.
 */
export async function probeAllAnchorIssuers(
  store: ProbeSampleStore,
  deps?: IssuerMismatchDeps,
  anchors: readonly Anchor[] = ANCHORS
): Promise<ProbeSample[]> {
  logger.info(
    { event: 'probe.issuer.all.start', anchorCount: anchors.length },
    'starting issuer-mismatch probe run'
  );
  const samples = await Promise.all(
    anchors.map((anchor) => probeIssuerMismatch(anchor, store, deps))
  );
  const mismatched = samples.filter((s) => s.failureType === 'mismatch').length;
  logger.info(
    { event: 'probe.issuer.all.complete', total: samples.length, mismatched },
    'issuer-mismatch probe run complete'
  );
  return samples;
}

// ─── Toml-integrity probe (Issue #D003) ────────────────────────────────────────
//
// Validates each anchor's stellar.toml against the SEP-1 required-field
// expectations (see `validateTomlIntegrity` in `lib/stellar/sep1`), flagging
// a missing SIGNING_KEY, a malformed TRANSFER_SERVER*/URL, or drift vs. the
// last known-good snapshot — none of which uptime alone would catch, since a
// broken toml doesn't take the domain offline.

/** Injectable dependencies for the toml-integrity probe. */
export interface TomlIntegrityDeps {
  /** Resolves an anchor's stellar.toml. Defaults to `resolveToml` from lib/stellar/sep1. */
  fetchToml?: (domain: string) => Promise<TomlResult>;
  /** Looks up the last known-good snapshot for a domain. Defaults to an in-memory, per-process map. */
  getLastKnownGood?: (domain: string) => Sep1TomlData | null;
  /** Records a validated-clean snapshot as the new last known-good. Defaults to the same in-memory map. */
  recordLastKnownGood?: (domain: string, toml: Sep1TomlData) => void;
  /** Monotonic-ish millisecond clock. Defaults to `Date.now`. */
  now?: () => number;
}

const lastKnownGoodToml = new Map<string, Sep1TomlData>();

function defaultGetLastKnownGood(domain: string): Sep1TomlData | null {
  return lastKnownGoodToml.get(domain) ?? null;
}

function defaultRecordLastKnownGood(domain: string, toml: Sep1TomlData): void {
  lastKnownGoodToml.set(domain, toml);
}

function resolveTomlIntegrityDeps(deps?: TomlIntegrityDeps): Required<TomlIntegrityDeps> {
  return {
    fetchToml: deps?.fetchToml ?? resolveToml,
    getLastKnownGood: deps?.getLastKnownGood ?? defaultGetLastKnownGood,
    recordLastKnownGood: deps?.recordLastKnownGood ?? defaultRecordLastKnownGood,
    now: deps?.now ?? Date.now,
  };
}

/**
 * Probe one anchor's toml-integrity check, recording exactly one sample.
 * `reachable: true` means the toml resolved and validated clean — the
 * snapshot is then recorded as the new last known-good. `reachable: false`
 * covers both a validation failure (an `integrity` failure type, distinguishable
 * from network failures) and a probe that could not complete (classified like
 * the other probes).
 */
export async function probeTomlIntegrity(
  domain: string,
  store: ProbeSampleStore,
  deps?: TomlIntegrityDeps
): Promise<ProbeSample> {
  const { fetchToml, getLastKnownGood, recordLastKnownGood, now } = resolveTomlIntegrityDeps(deps);
  const start = now();

  let reachable: boolean;
  let error: string | undefined;
  let failureType: ProbeFailureType | null = null;

  const result = await fetchToml(domain);
  if (!result.ok) {
    reachable = false;
    error = result.error;
    failureType = classifyFailure(error);
  } else {
    const previous = getLastKnownGood(domain);
    const validation = validateTomlIntegrity(result.data, previous);
    if (validation.valid) {
      reachable = true;
      recordLastKnownGood(domain, result.data);
    } else {
      reachable = false;
      failureType = 'integrity';
      error = validation.issues.map((issue) => `${issue.field}: ${issue.reason}`).join('; ');
    }
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
    { event: 'probe.integrity.sample', domain, reachable, failureType, error },
    'toml-integrity sample recorded'
  );
  store.record(sample);
  return sample;
}

/**
 * Runs the toml-integrity probe for every registered anchor, concurrently.
 * Defaults to the registered fleet in `constants/anchors.ts`; a different
 * anchor list may be injected for tests.
 */
export async function probeAllAnchorIntegrity(
  store: ProbeSampleStore,
  deps?: TomlIntegrityDeps,
  anchors: readonly Anchor[] = ANCHORS
): Promise<ProbeSample[]> {
  logger.info(
    { event: 'probe.integrity.all.start', anchorCount: anchors.length },
    'starting toml-integrity probe run'
  );
  const samples = await Promise.all(
    anchors.map((anchor) =>
      probeTomlIntegrity(anchor.serviceDomain ?? anchor.homeDomain, store, deps)
    )
  );
  const failed = samples.filter((s) => s.failureType === 'integrity').length;
  logger.info(
    { event: 'probe.integrity.all.complete', total: samples.length, failed },
    'toml-integrity probe run complete'
  );
  return samples;
}

// ─── Durable persistence adapter (Issue #D007) ─────────────────────────────────
//
// `ProbeSampleStore` (used by every probe function above) is the in-memory
// shape probes write to during a single run; it has no `kind`, since a probe
// runner only ever produces one kind of sample. This adapter fans each
// `record()` call out to a durable `ReputationStore`'s `recordProbeSample`,
// tagging every row with the `kind` it was constructed for, so a scheduled
// runner can point a probe function straight at the durable health ledger
// instead of accumulating in memory and being discarded when the process exits.

/** The minimal slice of `ReputationStore` this adapter depends on. */
export interface ProbeLedgerSink {
  recordProbeSample(row: ProbeLedgerRow): Promise<void>;
}

/**
 * Adapts a durable `ReputationStore` to the `ProbeSampleStore` interface any
 * probe function accepts, tagging every recorded sample with a fixed `kind`.
 * `record()` fires the write without awaiting it — probe functions call it
 * synchronously — so callers that need durability guarantees should `await`
 * on the returned promises via `recordAll`/`flush` semantics elsewhere, or
 * simply await the probe run and then `await drain()`.
 */
export class DurableProbeStore implements ProbeSampleStore {
  private readonly pending: Promise<void>[] = [];
  private persistedCount = 0;
  private failedCount = 0;

  constructor(
    private readonly sink: ProbeLedgerSink,
    private readonly kind: ProbeKind
  ) {}

  /** Samples this adapter has successfully written, as of the last `drain()`. */
  get persisted(): number {
    return this.persistedCount;
  }

  /**
   * Samples whose write rejected. Non-zero means the run produced samples that
   * never reached the ledger — a caller reporting success without checking this
   * is reporting a probe run that accumulated nothing (Issue #906).
   */
  get failed(): number {
    return this.failedCount;
  }

  record(sample: ProbeSample): void {
    const row: ProbeLedgerRow = {
      domain: sample.domain,
      kind: this.kind,
      corridor: sample.corridor ?? null,
      reachable: sample.reachable,
      latencyMs: sample.latencyMs,
      failureType: sample.failureType ?? null,
      error: sample.error ?? null,
      probedAt: new Date(sample.at).toISOString(),
    };
    this.pending.push(
      this.sink.recordProbeSample(row).then(
        () => {
          this.persistedCount += 1;
        },
        (err: unknown) => {
          this.failedCount += 1;
          logger.error(
            { event: 'probe.persist.error', domain: row.domain, kind: row.kind, err },
            'failed to persist probe sample to the durable store'
          );
        }
      )
    );
  }

  /** In-memory samples are not tracked by this adapter — it exists purely to persist. */
  samples(): ProbeSample[] {
    return [];
  }

  /** Awaits every write triggered by `record()` so far. */
  async drain(): Promise<void> {
    await Promise.all(this.pending.splice(0, this.pending.length));
  }
}

// ─── Probe-failure alerting (Issue #D016) ──────────────────────────────────────
//
// The probes above each answer one question about an anchor; this turns their
// per-cycle verdicts into a single composite health status and alerts when that
// status degrades. The debounce is the same consecutive-failure rule the
// nightly auto-degrade ledger uses (see `lib/reputation/thresholds.ts`), so one
// flaky cycle never pages anyone and a latched status never re-alerts.

/** The probe dimensions that feed an anchor's composite health status. */
export const PROBE_DIMENSIONS = ['uptime', 'latency', 'drift'] as const;
export type ProbeDimension = (typeof PROBE_DIMENSIONS)[number];

/** One anchor's results from a single probe cycle. Every dimension is optional — a cycle that didn't run a probe can't fail it. */
export interface ProbeCycle {
  /** Uptime probe sample (`probeAnchor`). */
  uptime?: ProbeSample | undefined;
  /** Quote-latency samples for this anchor (`probeQuoteLatency`), one per corridor. */
  latency?: readonly ProbeSample[] | undefined;
  /** This anchor's row from the cycle's `detectQuoteDrift` comparison. */
  drift?: DriftSample | undefined;
}

/**
 * Which dimensions failed in one cycle: `uptime` when the stellar.toml probe
 * was unreachable, `latency` when any quote sample was unreachable or busted
 * the round-trip budget, `drift` when the anchor's quote was flagged
 * off-median. Returned in `PROBE_DIMENSIONS` order so alert payloads are
 * stable regardless of which probe reported first.
 */
export function failingDimensions(
  cycle: ProbeCycle,
  latencyBudgetMs: number = LATENCY_BUDGET_MS
): ProbeDimension[] {
  const failing = new Set<ProbeDimension>();
  if (cycle.uptime && !cycle.uptime.reachable) failing.add('uptime');
  for (const sample of cycle.latency ?? []) {
    if (!sample.reachable || sample.latencyMs > latencyBudgetMs) failing.add('latency');
  }
  if (cycle.drift?.flagged) failing.add('drift');
  return PROBE_DIMENSIONS.filter((d) => failing.has(d));
}

/** A composite health status crossing into a worse state. */
export interface HealthAlert {
  anchorId: string;
  /** Status before this cycle. */
  from: AnchorHealthStatus;
  /** Status after this cycle; always strictly worse than `from`. */
  to: AnchorHealthStatus;
  /** Every dimension that failed at some point during the streak that tripped the transition, in `PROBE_DIMENSIONS` order. */
  dimensions: ProbeDimension[];
  /** Length of the consecutive-failure streak when the transition fired. */
  consecutiveFailures: number;
  /** Epoch milliseconds when the alert was raised. */
  at: number;
}

/**
 * Injected sink for health-degradation alerts. Left as a seam so this module
 * stays free of a concrete alerting dependency, mirroring the publisher's
 * `AlertHook` (#D014) — wire it to Sentry, a pager, or the ledger writer.
 */
export type HealthAlertHook = (alert: HealthAlert) => void | Promise<void>;

/** Tuning for `AnchorHealthTracker`; every field defaults to `lib/reputation/thresholds.ts`. */
export interface HealthTrackerOptions {
  /** Consecutive failing cycles before `healthy` → `degraded`. */
  degradeAfter?: number;
  /** Consecutive failing cycles before escalating to `down`. */
  downAfter?: number;
  /** Quote round-trip budget (ms) for the latency dimension. */
  latencyBudgetMs?: number;
  /** Called once per degrading transition. */
  onAlert?: HealthAlertHook;
  /** Monotonic-ish millisecond clock. Defaults to `Date.now`. */
  now?: () => number;
}

/** An anchor's tracked health, shaped to match the nightly ledger's `AnchorHealth`. */
export interface AnchorHealthState {
  status: AnchorHealthStatus;
  /** Consecutive failing cycles; reset to 0 by any clean cycle. */
  consecutiveFailures: number;
  /** Dimensions that failed during the current streak; empty when healthy. */
  dimensions: ProbeDimension[];
}

/**
 * Debounced per-anchor health state machine over probe cycles.
 *
 * Feed it one cycle per anchor per run: a failing cycle extends the anchor's
 * streak, a clean one resets it. The streak length maps to a composite status
 * via `healthStatusFor`, and an alert fires only when that status crosses into
 * a strictly worse state — so N-1 consecutive failures stay silent, the Nth
 * raises exactly one alert naming the failing dimension(s), and further
 * failures at the same level raise none. Recovery clears the streak silently;
 * this path alerts on degradation only.
 */
export class AnchorHealthTracker {
  private readonly states = new Map<string, AnchorHealthState>();
  private readonly degradeAfter: number;
  private readonly downAfter: number;
  private readonly latencyBudgetMs: number;
  private readonly onAlert: HealthAlertHook | undefined;
  private readonly now: () => number;

  constructor(options: HealthTrackerOptions = {}) {
    this.degradeAfter = options.degradeAfter ?? DEGRADE_AFTER_FAILURES;
    this.downAfter = options.downAfter ?? DOWN_AFTER_FAILURES;
    this.latencyBudgetMs = options.latencyBudgetMs ?? LATENCY_BUDGET_MS;
    this.onAlert = options.onAlert;
    this.now = options.now ?? Date.now;
  }

  /** Feed one probe cycle for one anchor. Returns the alert raised, or `null`. */
  async observe(anchorId: string, cycle: ProbeCycle): Promise<HealthAlert | null> {
    return this.observeFailures(anchorId, failingDimensions(cycle, this.latencyBudgetMs));
  }

  /**
   * Lower-level entry point for callers that already know which dimensions
   * failed (e.g. a dimension this module doesn't model yet).
   */
  async observeFailures(
    anchorId: string,
    failing: readonly ProbeDimension[]
  ): Promise<HealthAlert | null> {
    const prev = this.statusOf(anchorId);

    if (failing.length === 0) {
      this.states.set(anchorId, { status: 'healthy', consecutiveFailures: 0, dimensions: [] });
      if (prev.status !== 'healthy') {
        logger.info(
          { event: 'probe.health.recovered', anchorId, from: prev.status },
          'anchor recovered to healthy'
        );
      }
      return null;
    }

    const streakDimensions = PROBE_DIMENSIONS.filter(
      (d) => prev.dimensions.includes(d) || failing.includes(d)
    );
    const consecutiveFailures = prev.consecutiveFailures + 1;
    const status = healthStatusFor(consecutiveFailures, this.degradeAfter, this.downAfter);
    this.states.set(anchorId, { status, consecutiveFailures, dimensions: streakDimensions });

    if (!isDegradingTransition(prev.status, status)) {
      logger.debug(
        {
          event: 'probe.health.failure',
          anchorId,
          status,
          consecutiveFailures,
          dimensions: failing,
        },
        'probe cycle failed but health status is unchanged'
      );
      return null;
    }

    const alert: HealthAlert = {
      anchorId,
      from: prev.status,
      to: status,
      dimensions: streakDimensions,
      consecutiveFailures,
      at: this.now(),
    };
    logger.warn(
      {
        event: 'probe.health.transition',
        anchorId,
        from: alert.from,
        to: alert.to,
        dimensions: alert.dimensions,
        consecutiveFailures,
      },
      `anchor health degraded to ${status} (${alert.dimensions.join(', ')})`
    );
    await this.onAlert?.(alert);
    return alert;
  }

  /** Current tracked health for an anchor; unseen anchors read as healthy with no streak. */
  statusOf(anchorId: string): AnchorHealthState {
    const state = this.states.get(anchorId);
    if (!state) return { status: 'healthy', consecutiveFailures: 0, dimensions: [] };
    return { ...state, dimensions: [...state.dimensions] };
  }

  /** Every tracked anchor's health, keyed by anchor id — the shape the auto-degrade ledger consumes. */
  snapshot(): Record<string, AnchorHealthState> {
    const out: Record<string, AnchorHealthState> = {};
    for (const anchorId of this.states.keys()) {
      out[anchorId] = this.statusOf(anchorId);
    }
    return out;
  }
}
