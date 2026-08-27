/**
 * tests/router-multi-hop-selection.spec.ts
 *
 * Multi-hop route selection (#1088). router-hop-chain.spec.ts covers
 * chaining itself (asset continuity, per-hop fallback) with single-candidate
 * executors; it never exercises a chain where each hop has several competing
 * routes, and it never chains a swap into an off-ramp. This file covers both:
 * selecting between competing swap -> off-ramp routes, and re-selecting
 * deterministically when the best route becomes unavailable.
 *
 * Winners are derived from `computeRoutingScore` — the same formula the
 * single-anchor solver uses — rather than hardcoded, so the assertions track
 * the scoring order instead of a specific fixture id.
 */

import { describe, it, expect } from 'vitest';
import {
  solveChain,
  computeRoutingScore,
  DEFAULT_SCORING_WEIGHTS,
  type Hop,
  type HopExecutor,
  type PlannedHop,
} from '@/lib/router/solve';
import {
  USDC,
  XLM,
  NGN,
  SWAP_CANDIDATES,
  OFFRAMP_CANDIDATES,
  type RouteCandidateFixture,
} from './fixtures/router-multi-hop-routes';

/** Ranks fixture candidates by the production routing-score formula, best first. */
function rankByScore(candidates: RouteCandidateFixture[]): RouteCandidateFixture[] {
  const maxRate = Math.max(...candidates.map((c) => Number(c.estimatedOut)));
  const score = (c: RouteCandidateFixture) =>
    computeRoutingScore(
      Number(c.estimatedOut),
      maxRate,
      c.reliability,
      c.latencyMs,
      c.reputationComposite,
      DEFAULT_SCORING_WEIGHTS
    );
  return [...candidates].sort((a, b) => score(b) - score(a));
}

/** Builds a HopExecutor for a route candidate; `unavailable` makes planHop return null. */
function executorFor(
  kind: HopExecutor['kind'],
  candidate: RouteCandidateFixture,
  unavailable = false
): HopExecutor {
  return {
    kind,
    executorId: candidate.id,
    async planHop(hop: Hop): Promise<PlannedHop | null> {
      if (unavailable) return null;
      return {
        hop,
        executorId: candidate.id,
        estimatedOut: candidate.estimatedOut,
        fee: candidate.fee,
      };
    },
  };
}

const chain: Hop[] = [
  { kind: 'swap', sellAsset: USDC, buyAsset: XLM, minReceive: '1' },
  { kind: 'off-ramp', sellAsset: XLM, buyAsset: NGN, minReceive: '1' },
];

describe('solveChain — multi-hop route selection (#1088)', () => {
  it('selects the best-scored candidate at each hop of a swap -> off-ramp chain', async () => {
    const rankedSwap = rankByScore(SWAP_CANDIDATES);
    const rankedOffRamp = rankByScore(OFFRAMP_CANDIDATES);

    const executors: HopExecutor[] = [
      ...rankedSwap.map((c) => executorFor('swap', c)),
      ...rankedOffRamp.map((c) => executorFor('off-ramp', c)),
    ];

    const result = await solveChain(chain, executors);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.hops[0]!.executorId).toBe(rankedSwap[0]!.id);
    expect(result.plan.hops[1]!.executorId).toBe(rankedOffRamp[0]!.id);
    expect(result.plan.totalEstimatedOut).toBe(rankedOffRamp[0]!.estimatedOut);
  });

  it('deterministically re-selects the next-ranked route when the top off-ramp candidate becomes unavailable', async () => {
    const rankedSwap = rankByScore(SWAP_CANDIDATES);
    const rankedOffRamp = rankByScore(OFFRAMP_CANDIDATES);
    const [top, second] = rankedOffRamp;

    const executors: HopExecutor[] = [
      ...rankedSwap.map((c) => executorFor('swap', c)),
      executorFor('off-ramp', top!, true), // best-scored route goes unavailable
      ...rankedOffRamp.slice(1).map((c) => executorFor('off-ramp', c)),
    ];

    const result = await solveChain(chain, executors);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.hops[1]!.executorId).toBe(second!.id);
    expect(result.plan.hops[1]!.executorId).not.toBe(top!.id);
    expect(result.plan.totalEstimatedOut).toBe(second!.estimatedOut);
  });

  it('deterministically re-selects the next-ranked route when the top swap candidate becomes unavailable', async () => {
    const rankedSwap = rankByScore(SWAP_CANDIDATES);
    const rankedOffRamp = rankByScore(OFFRAMP_CANDIDATES);
    const [top, second] = rankedSwap;

    const executors: HopExecutor[] = [
      executorFor('swap', top!, true), // best-scored route goes unavailable
      ...rankedSwap.slice(1).map((c) => executorFor('swap', c)),
      ...rankedOffRamp.map((c) => executorFor('off-ramp', c)),
    ];

    const result = await solveChain(chain, executors);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.hops[0]!.executorId).toBe(second!.id);
    expect(result.plan.hops[0]!.executorId).not.toBe(top!.id);
  });

  it('fails the whole chain, at the failing hop, when every off-ramp route is unavailable', async () => {
    const rankedSwap = rankByScore(SWAP_CANDIDATES);

    const executors: HopExecutor[] = [
      ...rankedSwap.map((c) => executorFor('swap', c)),
      ...OFFRAMP_CANDIDATES.map((c) => executorFor('off-ramp', c, true)),
    ];

    const result = await solveChain(chain, executors);

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== 'no_route_for_hop') return;
    expect(result.hopIndex).toBe(1);
  });
});
