import { describe, expect, it } from 'vitest';
import * as router from './solve';

type Candidate = {
  anchorId: string;
  anchorName: string;
  corridorId: string;
  rate: number;
  netAmount: number;
  reputation: number;
  reputationScore: number;
  reputationThreshold: number;
  eligible: boolean;
};

const CORRIDOR_ID = 'usdc-ngn';
const REPUTATION_THRESHOLD = 0.5;

type ScoreFunction = (candidate: Candidate) => number;
type SolveFunction = (input: {
  corridorId: string;
  candidates: readonly Candidate[];
}) => unknown;

function getExport<T>(names: readonly string[]): T {
  const moduleExports = router as unknown as Record<string, unknown>;

  for (const name of names) {
    const value = moduleExports[name];
    if (typeof value === 'function') {
      return value as T;
    }
  }

  throw new Error(`solve.ts must export one of: ${names.join(', ')}`);
}

const scoreCandidate = getExport<ScoreFunction>([
  'scoreCandidate',
  'scoreRoute',
]);

const solveRoute = getExport<SolveFunction>([
  'solveRoute',
  'solveCorridor',
]);

function candidate(
  anchorId: string,
  overrides: Partial<Candidate> = {}
): Candidate {
  const reputation = overrides.reputation ?? 1;

  return {
    anchorId,
    anchorName: anchorId,
    corridorId: CORRIDOR_ID,
    rate: 1_500,
    netAmount: 150_000,
    reputation,
    reputationScore: reputation,
    reputationThreshold: REPUTATION_THRESHOLD,
    eligible: reputation >= REPUTATION_THRESHOLD,
    ...overrides,
  };
}

function selectedAnchor(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (typeof result !== 'object' || result === null) {
    throw new Error('The solver did not return a selected anchor.');
  }

  const value = result as Record<string, unknown>;
  const directAnchor = value.anchorId ?? value.selectedAnchorId;
  if (typeof directAnchor === 'string') {
    return directAnchor;
  }

  for (const key of ['route', 'plan', 'winner', 'selected']) {
    const nested = value[key];
    if (nested !== undefined) {
      return selectedAnchor(nested);
    }
  }

  throw new Error('The solver result does not identify an anchor.');
}

function solve(candidates: readonly Candidate[]): string {
  return selectedAnchor(
    solveRoute({
      corridorId: CORRIDOR_ID,
      candidates,
    })
  );
}

describe('scored router solver', () => {
  it('scores and selects the only eligible anchor in a single-anchor corridor', () => {
    const onlyAnchor = candidate('cowrie');

    expect(Number.isFinite(scoreCandidate(onlyAnchor))).toBe(true);
    expect(solve([onlyAnchor])).toBe('cowrie');
  });

  it('uses the deterministic anchor-id tie-break for equal-scoring candidates', () => {
    const anchorA = candidate('anchor-a');
    const anchorB = candidate('anchor-b');

    expect(scoreCandidate(anchorA)).toBe(scoreCandidate(anchorB));
    expect(solve([anchorB, anchorA])).toBe('anchor-a');
  });

  it('excludes an anchor below the reputation threshold', () => {
    const healthy = candidate('anchor-healthy', {
      netAmount: 149_000,
      reputation: 0.9,
    });
    const degraded = candidate('anchor-degraded', {
      netAmount: 160_000,
      reputation: 0.2,
    });

    expect(degraded.reputation).toBeLessThan(REPUTATION_THRESHOLD);
    expect(degraded.eligible).toBe(false);
    expect(solve([degraded, healthy])).toBe('anchor-healthy');
  });
});
