import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #790 — the multi-factor scorer existed but nothing supplied it real inputs,
// so it was dead code with default arguments. These tests pin that `scored`
// actually changes which anchor is chosen, and that missing reputation data
// degrades to rate-only rather than to a fabricated signal.

const VALID_KEY_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const VALID_KEY_B = 'GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777';

/** moneygram and cowrie both serve usdc-ngn, so the corridor has two candidates. */
const BOTH_ANCHORS = JSON.stringify({ moneygram: VALID_KEY_A, cowrie: VALID_KEY_B });

function mockRates(byAnchor: Record<string, number>) {
  vi.doMock('@/lib/api/rates-resolver', () => ({
    resolveCorridorRates: vi.fn().mockResolvedValue({
      comparison: {
        rates: Object.entries(byAnchor).map(([anchorId, totalReceived]) => ({
          anchorId,
          totalReceived,
        })),
      },
      servedFromCache: false,
      cacheStatus: 'MISS',
    }),
  }));
}

function mockScoringInputs(metrics: Record<string, unknown>, missing: string[] = []) {
  vi.doMock('@/lib/reputation/scoring-inputs', () => ({
    collectScoringInputs: vi.fn().mockResolvedValue({ anchorMetrics: metrics, missing }),
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', BOTH_ANCHORS);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@/lib/api/rates-resolver');
  vi.doUnmock('@/lib/reputation/scoring-inputs');
});

describe('first-match strategy (#790)', () => {
  it('takes the first candidate without consulting rates or reputation', async () => {
    const ratesSpy = vi.fn();
    vi.doMock('@/lib/api/rates-resolver', () => ({ resolveCorridorRates: ratesSpy }));

    const { selectAnchor } = await import('@/lib/intent/routing');
    const decision = await selectAnchor('usdc-ngn', '100', 'first-match');

    expect(decision?.target.anchorId).toBe('moneygram');
    expect(decision?.scores).toEqual({});
    // Preserving prior behaviour means doing no extra work — scored routing
    // puts a live rate fan-out on the request path, first-match must not.
    expect(ratesSpy).not.toHaveBeenCalled();
  });
});

describe('scored strategy (#790)', () => {
  it('picks the better-rated anchor when reputation is equal', async () => {
    mockRates({ moneygram: 100, cowrie: 150 });
    mockScoringInputs({
      moneygram: { reliability: 1, latencyMs: 100, reputationComposite: 1 },
      cowrie: { reliability: 1, latencyMs: 100, reputationComposite: 1 },
    });

    const { selectAnchor } = await import('@/lib/intent/routing');
    const decision = await selectAnchor('usdc-ngn', '100', 'scored');

    expect(decision?.target.anchorId).toBe('cowrie');
  });

  it('overrides a better rate when reputation is bad enough', async () => {
    // The point of the issue: selection must be able to differ from
    // first-match, and from rate alone.
    mockRates({ moneygram: 100, cowrie: 105 });
    mockScoringInputs({
      moneygram: { reliability: 1, latencyMs: 50, reputationComposite: 1 },
      cowrie: { reliability: 0.1, latencyMs: 1900, reputationComposite: 0.05 },
    });

    const { selectAnchor } = await import('@/lib/intent/routing');
    const decision = await selectAnchor('usdc-ngn', '100', 'scored');

    // cowrie quotes better but is unreliable and slow — moneygram wins.
    expect(decision?.target.anchorId).toBe('moneygram');
    expect(decision?.scores['moneygram']).toBeGreaterThan(decision?.scores['cowrie'] ?? 1);
  });

  it('reports degraded and falls back to rate-only when no reputation data exists', async () => {
    mockRates({ moneygram: 100, cowrie: 150 });
    mockScoringInputs({}, ['moneygram', 'cowrie']);

    const { selectAnchor } = await import('@/lib/intent/routing');
    const decision = await selectAnchor('usdc-ngn', '100', 'scored');

    // Never fabricate inputs — say so and rank on rate.
    expect(decision?.degraded).toBe(true);
    expect(decision?.target.anchorId).toBe('cowrie');
  });

  it('still routes when the rate lookup fails entirely', async () => {
    vi.doMock('@/lib/api/rates-resolver', () => ({
      resolveCorridorRates: vi.fn().mockRejectedValue(new Error('upstream down')),
    }));
    mockScoringInputs({
      moneygram: { reliability: 0.2 },
      cowrie: { reliability: 0.99 },
    });

    const { selectAnchor } = await import('@/lib/intent/routing');
    const decision = await selectAnchor('usdc-ngn', '100', 'scored');

    // Rates unavailable must not deny the route; reputation decides instead.
    expect(decision?.target.anchorId).toBe('cowrie');
  });

  it('returns null when no candidate has a configured account', async () => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', '{}');
    const { selectAnchor } = await import('@/lib/intent/routing');

    expect(await selectAnchor('usdc-ngn', '100', 'scored')).toBeNull();
  });

  it('skips scoring work when only one candidate is configured', async () => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ cowrie: VALID_KEY_B }));
    const ratesSpy = vi.fn();
    vi.doMock('@/lib/api/rates-resolver', () => ({ resolveCorridorRates: ratesSpy }));

    const { selectAnchor } = await import('@/lib/intent/routing');
    const decision = await selectAnchor('usdc-ngn', '100', 'scored');

    expect(decision?.target.anchorId).toBe('cowrie');
    // Scoring one candidate against itself is pure latency.
    expect(ratesSpy).not.toHaveBeenCalled();
  });
});
