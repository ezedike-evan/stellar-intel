/**
 * Tests for fee-adjusted rate ranking (lib/rate-ranking.ts).
 *
 * Covers:
 *  - computeNetReceived: flat fee, percent fee, combined, precision rounding
 *  - rankByNetReceived: correct sort order, ranking FLIPS when fees differ
 *  - bestRate: selects the highest net-received anchor
 *  - buildRateComparison: filters rejected results, builds sorted RateComparison
 *  - Currency precision: rounding applied before comparison
 *  - Property tests: monotonicity and stability invariants
 *
 * All arithmetic is deterministic — no network I/O.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeNetReceived,
  rankByNetReceived,
  bestRate,
  buildRateComparison,
  DEFAULT_FIAT_PRECISION,
} from '@/lib/rate-ranking';
import type { AnchorRate } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRate(
  anchorId: string,
  totalReceived: number,
  overrides?: Partial<AnchorRate>
): AnchorRate {
  return {
    anchorId,
    anchorName: `Anchor ${anchorId}`,
    corridorId: 'usdc-ngn',
    fee: 2.5,
    feeType: 'flat',
    exchangeRate: 1580,
    totalReceived,
    source: 'sep24-fee',
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── computeNetReceived ───────────────────────────────────────────────────────

describe('computeNetReceived', () => {
  it('computes basic netReceived: (amount - flatFee) * exchangeRate', () => {
    // (100 - 2) * 1580 = 154,840
    expect(computeNetReceived(100, 2, 0, 1580)).toBe(154_840);
  });

  it('applies percentage fee after flat fee', () => {
    // (100 - 0) * (1 - 1%) * 1580 = 99 * 1580 = 156,420
    expect(computeNetReceived(100, 0, 1, 1580)).toBe(156_420);
  });

  it('applies both flat and percent fees combined', () => {
    // (100 - 2) * (1 - 1%) * 1580 = 98 * 0.99 * 1580 = 97.02 * 1580 = 153,291.6 -> 153,291.60
    expect(computeNetReceived(100, 2, 1, 1580)).toBeCloseTo(153_291.6, 1);
  });

  it('returns 0 for a zero exchange rate', () => {
    expect(computeNetReceived(100, 2, 0, 0)).toBe(0);
  });

  it('returns 0 when fees exceed the sell amount', () => {
    expect(computeNetReceived(10, 20, 0, 1580)).toBe(0);
  });

  it('respects precision parameter - rounds to 0 decimals', () => {
    // (100 - 2) * 1580 = 154,840 - already an integer, no change
    expect(computeNetReceived(100, 2, 0, 1580, 0)).toBe(154_840);
  });

  it('respects precision parameter - rounds to 3 decimals (KWD)', () => {
    const raw = (100 - 2) * 0.30501; // ~29.89098
    const expected = Math.round(raw * 1000) / 1000;
    expect(computeNetReceived(100, 2, 0, 0.30501, 3)).toBe(expected);
  });
});

// ─── rankByNetReceived - basic sort ──────────────────────────────────────────

describe('rankByNetReceived - basic sort', () => {
  it('sorts rates descending by totalReceived', () => {
    const rates = [makeRate('a', 100), makeRate('b', 300), makeRate('c', 200)];

    const ranked = rankByNetReceived(rates);

    expect(ranked.map((r) => r.anchorId)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const rates = [makeRate('a', 200), makeRate('b', 100)];
    const original = [...rates];
    rankByNetReceived(rates);
    expect(rates.map((r) => r.anchorId)).toEqual(original.map((r) => r.anchorId));
  });

  it('places unavailable rates (null totalReceived) last', () => {
    const rates = [
      makeRate('a', 100),
      makeRate('unavailable', 0, { totalReceived: null }),
      makeRate('b', 50),
    ];

    const ranked = rankByNetReceived(rates);
    expect(ranked.at(-1)!.anchorId).toBe('unavailable');
  });

  it('handles a single rate', () => {
    const ranked = rankByNetReceived([makeRate('only', 500)]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.anchorId).toBe('only');
  });

  it('handles an empty array', () => {
    expect(rankByNetReceived([])).toEqual([]);
  });
});

// ─── rankByNetReceived - ranking FLIPS when fees differ ──────────────────────

describe('rankByNetReceived - ranking flips when fees differ', () => {
  /**
   * Core acceptance criterion for Issue #174:
   * the ranking must change when fee structures differ, even if the gross
   * exchange rate is higher for the ultimately lower-ranked anchor.
   *
   * Scenario:
   *   Anchor X: exchangeRate=1600, fee=20  -> netReceived=(100-20)*1600=128,000
   *   Anchor Y: exchangeRate=1580, fee=1   -> netReceived=(100-1)*1580=156,420
   *   Y wins despite a lower gross rate because its fee is much smaller.
   */
  it('higher-rate anchor loses to lower-rate anchor with smaller fee (fee-flip scenario)', () => {
    const anchorX = makeRate('high-rate-high-fee', (100 - 20) * 1600, {
      fee: 20,
      exchangeRate: 1600,
    });
    const anchorY = makeRate('lower-rate-low-fee', (100 - 1) * 1580, {
      fee: 1,
      exchangeRate: 1580,
    });

    // Sanity: gross rates - X has higher rate
    expect(anchorX.exchangeRate).toBeGreaterThan(anchorY.exchangeRate!);

    // Net-received: Y should win
    expect(anchorY.totalReceived!).toBeGreaterThan(anchorX.totalReceived!);

    const ranked = rankByNetReceived([anchorX, anchorY]);
    expect(ranked[0]!.anchorId).toBe('lower-rate-low-fee');
    expect(ranked[1]!.anchorId).toBe('high-rate-high-fee');
  });

  it('ranking flips when fees increase - previously-best anchor drops to second', () => {
    // Step 1: Anchor A is best with fee=0
    const anchorA_lowFee = makeRate('anchor-a', (100 - 0) * 1580, {
      fee: 0,
      exchangeRate: 1580,
      totalReceived: (100 - 0) * 1580, // 158,000
    });
    const anchorB = makeRate('anchor-b', (100 - 5) * 1575, {
      fee: 5,
      exchangeRate: 1575,
      totalReceived: (100 - 5) * 1575, // 149,625
    });

    const ranked1 = rankByNetReceived([anchorA_lowFee, anchorB]);
    expect(ranked1[0]!.anchorId).toBe('anchor-a'); // A wins with zero fee

    // Step 2: Anchor A raises its fee - ranking flips
    const anchorA_highFee = makeRate('anchor-a', (100 - 50) * 1580, {
      fee: 50,
      exchangeRate: 1580,
      totalReceived: (100 - 50) * 1580, // 79,000
    });

    const ranked2 = rankByNetReceived([anchorA_highFee, anchorB]);
    expect(ranked2[0]!.anchorId).toBe('anchor-b'); // B now wins
    expect(ranked2[1]!.anchorId).toBe('anchor-a');
  });

  it('three-anchor scenario: fee differences cause non-obvious ranking order', () => {
    // Gross exchange rates (descending): C > B > A
    // After fees, order flips entirely: A > B > C
    const anchorA = makeRate('anchor-a', (100 - 1) * 1550, {
      fee: 1,
      exchangeRate: 1550, // lowest gross rate
      totalReceived: (100 - 1) * 1550, // 99 * 1550 = 153,450
    });
    const anchorB = makeRate('anchor-b', (100 - 10) * 1570, {
      fee: 10,
      exchangeRate: 1570,
      totalReceived: (100 - 10) * 1570, // 90 * 1570 = 141,300
    });
    const anchorC = makeRate('anchor-c', (100 - 30) * 1600, {
      fee: 30,
      exchangeRate: 1600, // highest gross rate
      totalReceived: (100 - 30) * 1600, // 70 * 1600 = 112,000
    });

    // Input is in wrong order deliberately - should still sort correctly
    const ranked = rankByNetReceived([anchorC, anchorB, anchorA]);
    expect(ranked.map((r) => r.anchorId)).toEqual(['anchor-a', 'anchor-b', 'anchor-c']);
  });

  it('equal net-received - original order preserved (sort stability)', () => {
    const rates = [makeRate('first', 100_000), makeRate('second', 100_000)];

    const ranked = rankByNetReceived(rates);
    expect(ranked[0]!.anchorId).toBe('first');
    expect(ranked[1]!.anchorId).toBe('second');
  });
});

// ─── bestRate ─────────────────────────────────────────────────────────────────

describe('bestRate', () => {
  it('returns the anchor with the highest netReceived', () => {
    const rates = [makeRate('a', 100), makeRate('b', 300), makeRate('c', 200)];
    expect(bestRate(rates)?.anchorId).toBe('b');
  });

  it('returns null for an empty array', () => {
    expect(bestRate([])).toBeNull();
  });

  it('returns the sole entry for a single-item array', () => {
    const rate = makeRate('only', 500);
    expect(bestRate([rate])?.anchorId).toBe('only');
  });
});

// ─── buildRateComparison ──────────────────────────────────────────────────────

describe('buildRateComparison', () => {
  it('builds a sorted comparison from settled results', () => {
    const settled: PromiseSettledResult<AnchorRate>[] = [
      { status: 'fulfilled', value: makeRate('a', 100) },
      { status: 'fulfilled', value: makeRate('b', 300) },
      { status: 'fulfilled', value: makeRate('c', 200) },
    ];

    const comparison = buildRateComparison(settled, 'usdc-ngn');

    expect(comparison.corridorId).toBe('usdc-ngn');
    expect(comparison.bestRateId).toBe('b');
    expect(comparison.rates.map((r) => r.anchorId)).toEqual(['b', 'c', 'a']);
  });

  it('discards rejected results', () => {
    const settled: PromiseSettledResult<AnchorRate>[] = [
      { status: 'fulfilled', value: makeRate('a', 100) },
      { status: 'rejected', reason: new Error('timeout') },
      { status: 'fulfilled', value: makeRate('b', 300) },
    ];

    const comparison = buildRateComparison(settled, 'usdc-ngn');
    expect(comparison.rates).toHaveLength(2);
    expect(comparison.bestRateId).toBe('b');
  });

  it('returns empty comparison when all results are rejected', () => {
    const settled: PromiseSettledResult<AnchorRate>[] = [
      { status: 'rejected', reason: new Error('network') },
    ];

    const comparison = buildRateComparison(settled, 'usdc-ngn');
    expect(comparison.rates).toHaveLength(0);
    expect(comparison.bestRateId).toBe('');
  });
});

// ─── Currency precision ───────────────────────────────────────────────────────

describe('DEFAULT_FIAT_PRECISION', () => {
  it('is 2', () => {
    expect(DEFAULT_FIAT_PRECISION).toBe(2);
  });
});

// ─── Property-based tests ─────────────────────────────────────────────────────

describe('rankByNetReceived - property tests', () => {
  it('bestRateId always has the maximum totalReceived', () => {
    fc.assert(
      fc.property(
        // Use integer-valued floats to avoid subnormal precision issues
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1 }),
        (totals) => {
          const rates = totals.map((total, idx) => makeRate(`anchor-${idx}`, total));
          const ranked = rankByNetReceived(rates);
          const top = ranked[0]!;
          const maxTotal = Math.max(...totals);
          expect(top.totalReceived).toBe(maxTotal);
        }
      )
    );
  });

  it('ranking order is stable regardless of input order', () => {
    fc.assert(
      fc.property(
        // Use integer-valued floats to avoid subnormal precision issues
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1 }),
        (totals) => {
          const rates = totals.map((total, idx) => makeRate(`anchor-${idx}`, total));
          const reversed = [...rates].reverse();

          const ranked1 = rankByNetReceived(rates);
          const ranked2 = rankByNetReceived(reversed);

          // Top net-received values should be identical
          expect(ranked1[0]!.totalReceived).toBe(ranked2[0]!.totalReceived);
        }
      )
    );
  });

  it('output length equals input length', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000 }), {
          minLength: 0,
          maxLength: 20,
        }),
        (totals) => {
          const rates = totals.map((total, idx) => makeRate(`anchor-${idx}`, total));
          expect(rankByNetReceived(rates)).toHaveLength(totals.length);
        }
      )
    );
  });
});
