import { env } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { computeRoutingScore, type RoutingStrategy } from '@/lib/router/solve';
import { collectScoringInputs } from '@/lib/reputation/scoring-inputs';
import { resolveCorridorRates } from '@/lib/api/rates-resolver';
import { routingTargetsForCorridor, type AnchorRoutingTarget } from '@/lib/intent/anchor-accounts';

const log = getLogger('intent/routing');

// ─── Intent routing (Issue #790) ──────────────────────────────────────────────
//
// The intent API used to pick an anchor from a hardcoded map (#941). Now it
// picks from the registry, and under the `scored` strategy it uses the
// multi-factor scorer with real reputation inputs instead of taking whichever
// anchor happens to be listed first.
//
// Deliberately does NOT go through solveSingleAnchor. That solver operates on
// EvaluatedQuote, which extends Sep38Quote — it needs firm quotes. Per #720
// exactly one registered anchor advertises SEP-38 and it does not serve any
// corridor the intent API routes, so routing every intent through it would mean
// synthesising fake Sep38Quote objects from indicative rates. `computeRoutingScore`
// is a pure function and is used directly instead.

export interface RoutingDecision {
  target: AnchorRoutingTarget;
  strategy: RoutingStrategy;
  /** Score per candidate under `scored`; empty under `first-match`. */
  scores: Record<string, number>;
  /** True when scoring ran with no reputation data and fell back to rate-only. */
  degraded: boolean;
}

/**
 * Chooses an anchor for `corridorId`.
 *
 * `first-match` takes the first configured candidate, preserving prior
 * behaviour. `scored` ranks candidates on rate, reputation, reliability and
 * latency. Either way the candidate set is the registry filtered to anchors
 * with a verified payment account.
 */
export async function selectAnchor(
  corridorId: string,
  amount: string,
  strategy: RoutingStrategy = env.ROUTING_STRATEGY
): Promise<RoutingDecision | null> {
  const candidates = routingTargetsForCorridor(corridorId);
  if (candidates.length === 0) return null;

  if (strategy === 'first-match' || candidates.length === 1) {
    const target = candidates[0]!;
    log.info({
      event: 'routing.decision',
      strategy: candidates.length === 1 ? strategy : 'first-match',
      corridorId,
      candidates: candidates.map((c) => c.anchorId),
      chosen: target.anchorId,
      reason: candidates.length === 1 ? 'only_candidate' : 'first_match',
    });
    return { target, strategy, scores: {}, degraded: false };
  }

  // Rates give the scorer its dominant term. A failure here is not fatal —
  // every candidate simply scores equally on rate.
  let ratesByAnchor: Record<string, number> = {};
  try {
    const { comparison } = await resolveCorridorRates(corridorId, amount);
    ratesByAnchor = Object.fromEntries(
      comparison.rates
        .filter((r) => r.totalReceived !== null)
        .map((r) => [r.anchorId, r.totalReceived as number])
    );
  } catch (err) {
    log.warn({
      event: 'routing.rates_unavailable',
      corridorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const { anchorMetrics, missing } = await collectScoringInputs(candidates.map((c) => c.anchorId));
  const degraded = Object.keys(anchorMetrics).length === 0;

  const maxRate = Math.max(0, ...Object.values(ratesByAnchor));
  const scores: Record<string, number> = {};

  for (const candidate of candidates) {
    const metrics = anchorMetrics[candidate.anchorId];
    scores[candidate.anchorId] = computeRoutingScore(
      ratesByAnchor[candidate.anchorId] ?? 0,
      maxRate,
      metrics?.reliability,
      metrics?.latencyMs,
      metrics?.reputationComposite
    );
  }

  // Ties resolve to registry order, which is what `candidates` already is.
  const target = candidates.reduce((best, c) =>
    (scores[c.anchorId] ?? 0) > (scores[best.anchorId] ?? 0) ? c : best
  );

  log.info({
    event: 'routing.decision',
    strategy: 'scored',
    corridorId,
    candidates: candidates.map((c) => c.anchorId),
    scores,
    missingMetrics: missing,
    degraded,
    chosen: target.anchorId,
  });

  return { target, strategy: 'scored', scores, degraded };
}
