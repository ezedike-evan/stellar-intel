/**
 * lib/reputation/health.ts
 *
 * Probe-derived anchor health — the half of the record this project observes
 * for itself.
 *
 * There are two distinct records in this codebase and they must never be added
 * together:
 *
 *   health      what we observed by probing an anchor every five minutes:
 *               uptime, quote availability, issuer match, TOML integrity.
 *               Real data exists today.
 *
 *   reputation  what happened when a user actually settled through an anchor:
 *               fill rate, settlement time, slippage. Needs settled
 *               transactions, of which there are none yet.
 *
 * The composite score in `composite.ts` is execution-derived and stays that
 * way. Nothing here feeds it. An anchor can be perfectly healthy and still
 * carry no reputation score, and that is the honest reading — it has not
 * performed badly, it has not been observed performing at all.
 *
 * Before this module the four probe sweeps wrote to `probe_samples` every five
 * minutes and only `uptime` rows were ever read back, by the coverage report.
 * The other three kinds accumulated unread.
 */

import type { ProbeFailureType, ProbeKind, ProbeLedgerRow } from '@/types/reputation';
import { ANCHORS } from '@/constants/anchors';
import { computeLatencyPercentiles, type ReputationStore } from './store';
import {
  anchorProbeDomains,
  buildProbeCoverageReport,
  type ProbeCoverageSample,
} from './aggregate';

// ─── Shape ────────────────────────────────────────────────────────────────────

/** The four probe signals, named as the product speaks about them. */
export type HealthSignalKey = 'uptime' | 'quoteAvailability' | 'issuerMatch' | 'tomlIntegrity';

/** Maps a stored `ProbeKind` to the signal it reports. */
export const SIGNAL_BY_PROBE_KIND: Record<ProbeKind, HealthSignalKey> = {
  uptime: 'uptime',
  quote: 'quoteAvailability',
  'issuer-mismatch': 'issuerMatch',
  'toml-integrity': 'tomlIntegrity',
};

/**
 * Failure types that are a verdict about the anchor, per signal. A failure of
 * any other type means the check did not complete, and is excluded from that
 * signal's counts entirely.
 *
 * This distinction is load-bearing and the probe layer already draws it:
 * `probeIssuerMismatch` documents that `reachable: false` "covers both a
 * genuine mismatch (a `mismatch` failure type, distinguishable from network
 * failures) and a probe that could not complete". Collapsing the two publishes
 * an accusation the data does not support — MoneyGram's issuer check has never
 * once returned `mismatch`, only `unknown`, and reporting that as "0% issuer
 * match" would say on a public page that a real company misrepresents its
 * asset issuer.
 *
 * `uptime` and `quote` are liveness observations rather than comparisons: a
 * request that did not come back is the answer, whatever the transport reason,
 * so every failure type counts for those two.
 */
const VERDICT_FAILURES: Record<HealthSignalKey, ReadonlySet<ProbeFailureType> | 'all'> = {
  uptime: 'all',
  quoteAvailability: 'all',
  issuerMatch: new Set<ProbeFailureType>(['mismatch']),
  tomlIntegrity: new Set<ProbeFailureType>(['integrity']),
};

function isVerdict(key: HealthSignalKey, row: ProbeLedgerRow): boolean {
  if (row.reachable) return true;
  const verdicts = VERDICT_FAILURES[key];
  if (verdicts === 'all') return true;
  return row.failureType !== null && verdicts.has(row.failureType);
}

export interface HealthSignal {
  /** Probe rows of this kind inside the window that produced a verdict. */
  samples: number;
  /** Rows where the check passed. */
  successes: number;
  /**
   * Rows where the check ran but could not reach a verdict about the anchor —
   * an issuer comparison that never completed, say. Reported so the gap is
   * visible, never counted as a failure.
   */
  incomplete: number;
  /**
   * successes / samples, or `null` when nothing was sampled. Never 0 for an
   * unsampled signal — "we did not look" and "it failed every time" are
   * opposite claims and must not share a value.
   */
  successRate: number | null;
  /** Round-trip percentiles. Only `uptime` and `quote` rows carry a latency. */
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  lastSampleAt: string | null;
  lastFailureAt: string | null;
  lastFailureType: ProbeFailureType | null;
}

export interface AnchorHealth {
  anchorId: string;
  domain: string;
  windowDays: number;
  /** This record's own state. Independent of `Scorecard.state`. */
  state: 'ok' | 'insufficient_data';
  /** Probe rows across all four kinds that produced a verdict about the anchor. */
  sampleSize: number;
  /** Rows inside the window whose check never reached a verdict. */
  incompleteChecks: number;
  /** Calendar days with at least one probe, and the current unbroken streak. */
  observedDays: number;
  continuousDays: number;
  signals: Record<HealthSignalKey, HealthSignal>;
  /** Weighted mean of the sampled signals, in [0,1]. `null` unless state is 'ok'. */
  healthScore: number | null;
  computedAt: string;
}

// ─── Method ───────────────────────────────────────────────────────────────────

/**
 * Weights for the health score. Deliberately named apart from the composite's
 * WEIGHT_FILL / WEIGHT_SLIPPAGE / WEIGHT_SETTLE so the two methods cannot be
 * confused at a call site.
 *
 * Uptime carries the most weight because it is the signal a user feels first:
 * an anchor that does not answer cannot be used at any price. Quote
 * availability, issuer match and TOML integrity divide the rest evenly — each
 * is a binary claim about whether what the anchor publishes is still true.
 */
export const HEALTH_WEIGHTS: Record<HealthSignalKey, number> = {
  uptime: 0.4,
  quoteAvailability: 0.2,
  issuerMatch: 0.2,
  tomlIntegrity: 0.2,
};

/**
 * Minimum probe rows before a health score is published — roughly one hour at
 * the five-minute cadence. Below this the signals are still reported (they are
 * observations, and true), but no score is computed from them.
 */
export const MIN_HEALTH_SAMPLES = 12;

/** Default window. Matches the 30-day window the reputation scorecard reports. */
export const DEFAULT_HEALTH_WINDOW_DAYS = 30;

const EMPTY_SIGNAL: HealthSignal = {
  samples: 0,
  successes: 0,
  incomplete: 0,
  successRate: null,
  latencyP50Ms: null,
  latencyP95Ms: null,
  lastSampleAt: null,
  lastFailureAt: null,
  lastFailureType: null,
};

function emptySignals(): Record<HealthSignalKey, HealthSignal> {
  return {
    uptime: { ...EMPTY_SIGNAL },
    quoteAvailability: { ...EMPTY_SIGNAL },
    issuerMatch: { ...EMPTY_SIGNAL },
    tomlIntegrity: { ...EMPTY_SIGNAL },
  };
}

/**
 * Weighted mean of the signals that were actually sampled, with the weights
 * renormalised over exactly those signals.
 *
 * A signal that never ran must not score zero. If the quote sweep has not run
 * for an anchor, that anchor has not failed quote availability — the question
 * was not asked, and scoring it 0 would publish a failure we never observed.
 *
 * Returns `null` when no signal has a sample.
 */
export function probeHealthScore(signals: Record<HealthSignalKey, HealthSignal>): number | null {
  let weighted = 0;
  let weightSum = 0;

  for (const key of Object.keys(HEALTH_WEIGHTS) as HealthSignalKey[]) {
    const signal = signals[key];
    if (signal.successRate === null) continue;
    const weight = HEALTH_WEIGHTS[key];
    weighted += weight * signal.successRate;
    weightSum += weight;
  }

  if (weightSum === 0) return null;
  return weighted / weightSum;
}

// ─── Computation ──────────────────────────────────────────────────────────────

export interface ComputeAnchorHealthInput {
  anchorId: string;
  domain: string;
  windowDays?: number;
  now?: Date;
}

/**
 * Pure: probe rows in, one anchor's health record out.
 *
 * `rows` may contain any mix of kinds and may span any period; only rows inside
 * the window are counted. Input order does not matter.
 */
export function computeAnchorHealth(
  rows: readonly ProbeLedgerRow[],
  input: ComputeAnchorHealthInput
): AnchorHealth {
  const windowDays = input.windowDays ?? DEFAULT_HEALTH_WINDOW_DAYS;
  const now = input.now ?? new Date();
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const windowed = rows
    .filter((row) => {
      const at = Date.parse(row.probedAt);
      return Number.isFinite(at) && at >= cutoffMs && at <= now.getTime();
    })
    .sort((a, b) => Date.parse(a.probedAt) - Date.parse(b.probedAt));

  const byKind = new Map<ProbeKind, ProbeLedgerRow[]>();
  for (const row of windowed) {
    const bucket = byKind.get(row.kind);
    if (bucket) bucket.push(row);
    else byKind.set(row.kind, [row]);
  }

  const signals = emptySignals();

  for (const [kind, allKindRows] of byKind) {
    const key = SIGNAL_BY_PROBE_KIND[kind];

    // Rows that could not reach a verdict about the anchor are counted and
    // reported, but never scored. See VERDICT_FAILURES.
    const kindRows = allKindRows.filter((row) => isVerdict(key, row));
    const incomplete = allKindRows.length - kindRows.length;

    const successes = kindRows.filter((row) => row.reachable).length;
    const failures = kindRows.filter((row) => !row.reachable);
    const lastFailure = failures[failures.length - 1];
    const lastRow = allKindRows[allKindRows.length - 1];

    // issuer-mismatch and toml-integrity rows are recorded with latencyMs 0 —
    // they are comparisons, not round trips — so percentiles are meaningless
    // for them and stay null rather than reading as an instant response.
    const carriesLatency = kind === 'uptime' || kind === 'quote';
    const latency = carriesLatency ? computeLatencyPercentiles(kindRows) : null;

    signals[key] = {
      samples: kindRows.length,
      successes,
      incomplete,
      successRate: kindRows.length > 0 ? successes / kindRows.length : null,
      latencyP50Ms: latency?.p50Ms ?? null,
      latencyP95Ms: latency?.p95Ms ?? null,
      lastSampleAt: lastRow?.probedAt ?? null,
      lastFailureAt: lastFailure?.probedAt ?? null,
      lastFailureType: lastFailure?.failureType ?? null,
    };
  }

  const observedDays = new Set(windowed.map((row) => row.probedAt.slice(0, 10))).size;
  // Only verdict rows count toward the threshold that releases a score: twelve
  // checks that never completed are not twelve observations of the anchor.
  const sampleSize = Object.values(signals).reduce((total, s) => total + s.samples, 0);
  const incompleteChecks = windowed.length - sampleSize;
  const state: AnchorHealth['state'] =
    sampleSize >= MIN_HEALTH_SAMPLES ? 'ok' : 'insufficient_data';

  return {
    anchorId: input.anchorId,
    domain: input.domain,
    windowDays,
    state,
    sampleSize,
    incompleteChecks,
    observedDays,
    continuousDays: continuousDayStreak(windowed, now),
    signals,
    healthScore: state === 'ok' ? probeHealthScore(signals) : null,
    computedAt: now.toISOString(),
  };
}

/**
 * Length of the unbroken run of UTC calendar days with at least one probe,
 * counting back from the most recent observed day.
 *
 * A streak that ended before yesterday is not a current streak: an anchor last
 * probed a week ago is not on a seven-day run, so the count is 0 unless the
 * last observation is today or yesterday.
 */
function continuousDayStreak(rows: readonly ProbeLedgerRow[], now: Date): number {
  if (rows.length === 0) return 0;

  const days = [...new Set(rows.map((row) => row.probedAt.slice(0, 10)))].sort();
  const lastDay = days[days.length - 1]!;
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (lastDay !== today && lastDay !== yesterday) return 0;

  let streak = 1;
  for (let i = days.length - 1; i > 0; i -= 1) {
    const current = Date.parse(`${days[i]!}T00:00:00.000Z`);
    const previous = Date.parse(`${days[i - 1]!}T00:00:00.000Z`);
    if (current - previous !== 24 * 60 * 60 * 1000) break;
    streak += 1;
  }
  return streak;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

export interface LoadAnchorHealthOptions {
  windowDays?: number;
  now?: Date;
  anchors?: ReadonlyArray<{ id: string; homeDomain: string; serviceDomain?: string }>;
}

/**
 * Health for every anchor in the fleet, keyed by anchor id.
 *
 * One query for the whole fleet, with no `kind` filter — that is the change
 * that makes the quote, issuer-mismatch and toml-integrity rows load-bearing
 * instead of merely stored. `observedDays` and `continuousDays` are taken from
 * `buildProbeCoverageReport`, the same function behind
 * GET /api/reputation/probe-coverage, so the two surfaces cannot disagree.
 */
export async function loadAnchorHealth(
  store: ReputationStore,
  options: LoadAnchorHealthOptions = {}
): Promise<Map<string, AnchorHealth>> {
  const anchors = options.anchors ?? ANCHORS;
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? DEFAULT_HEALTH_WINDOW_DAYS;
  const domains = anchorProbeDomains(anchors);

  const rows = await store.queryProbeSamples();

  const byDomain = new Map<string, ProbeLedgerRow[]>();
  for (const row of rows) {
    const bucket = byDomain.get(row.domain);
    if (bucket) bucket.push(row);
    else byDomain.set(row.domain, [row]);
  }

  // Coverage is reported over uptime rows only, matching the probe-coverage
  // endpoint — mixing the other kinds in would inflate the streak.
  const uptimeByDomain = new Map<string, ProbeCoverageSample[]>();
  for (const [domain, domainRows] of byDomain) {
    uptimeByDomain.set(
      domain,
      domainRows
        .filter((row) => row.kind === 'uptime')
        .map((row) => ({ probedAt: row.probedAt, kind: row.kind }))
    );
  }
  const coverage = buildProbeCoverageReport(uptimeByDomain, domains, { now });
  const coverageByAnchor = new Map(coverage.anchors.map((entry) => [entry.anchorId, entry]));

  const result = new Map<string, AnchorHealth>();
  for (const { anchorId, domain } of domains) {
    const health = computeAnchorHealth(byDomain.get(domain) ?? [], {
      anchorId,
      domain,
      windowDays,
      now,
    });

    const anchorCoverage = coverageByAnchor.get(anchorId);
    result.set(anchorId, {
      ...health,
      observedDays: anchorCoverage?.coveredDays ?? health.observedDays,
      continuousDays: anchorCoverage?.continuousDays ?? health.continuousDays,
    });
  }

  return result;
}

// ─── Wire shape ───────────────────────────────────────────────────────────────

/**
 * The `health` object attached to leaderboard rows and the anchor scorecard
 * response. Flatter than `AnchorHealth` because API consumers want the four
 * rates, not the full signal records.
 */
export interface HealthSummary {
  state: AnchorHealth['state'];
  score: number | null;
  observedDays: number;
  continuousDays: number;
  probeSamples: number;
  incompleteChecks: number;
  uptimeRate: number | null;
  quoteAvailability: number | null;
  issuerMatchRate: number | null;
  tomlIntegrityRate: number | null;
}

export function toHealthSummary(health: AnchorHealth): HealthSummary {
  return {
    state: health.state,
    score: health.healthScore,
    observedDays: health.observedDays,
    continuousDays: health.continuousDays,
    probeSamples: health.sampleSize,
    incompleteChecks: health.incompleteChecks,
    uptimeRate: health.signals.uptime.successRate,
    quoteAvailability: health.signals.quoteAvailability.successRate,
    issuerMatchRate: health.signals.issuerMatch.successRate,
    tomlIntegrityRate: health.signals.tomlIntegrity.successRate,
  };
}
