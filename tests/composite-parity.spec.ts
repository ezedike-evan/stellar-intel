import { describe, it, expect } from 'vitest';
import { composite, weightedComposite, NORM_SETTLE_SECONDS } from '@/lib/reputation/composite';

// #917 — `computeComposite` was copy-pasted into three files, and none of them
// said that it differs from `composite`. These tests pin both formulas and,
// crucially, pin that they DISAGREE, so the divergence cannot be rediscovered
// by accident a third time.

describe('composite (published formula)', () => {
  it('matches docs/ANCHOR_REPUTATION.md and the Soroban contract', () => {
    // score = fillRate × (1 − slippage) ÷ (settleSeconds / 300)
    expect(composite({ fillRate: 1, slippage: 0, settleSeconds: NORM_SETTLE_SECONDS })).toBe(1);
  });

  it('exceeds 1 for faster-than-reference settlement', () => {
    // Unbounded above — this is why it cannot be dropped into a UI that
    // renders a percentage.
    expect(composite({ fillRate: 1, slippage: 0, settleSeconds: 150 })).toBe(2);
  });
});

describe('weightedComposite (display ranking)', () => {
  it('stays within [0, 1]', () => {
    expect(weightedComposite(1, 0, 0)).toBe(1);
    expect(weightedComposite(0, 10_000, 1)).toBe(0);
  });

  it('clamps out-of-range inputs rather than propagating them', () => {
    expect(weightedComposite(5, -10, -1)).toBe(1);
  });
});

describe('the two formulas are not interchangeable (#917)', () => {
  it('disagree on the same inputs', () => {
    const metrics = { fillRate: 0.9, slippage: 0.01, settleSeconds: 120 };
    const published = composite(metrics);
    const display = weightedComposite(metrics.fillRate, metrics.settleSeconds, metrics.slippage);

    // If these ever converge, someone has changed one of them — and the
    // leaderboard and the on-chain oracle would start telling different
    // stories, or stop telling different stories, silently.
    expect(published).not.toBeCloseTo(display, 3);
  });

  it('rank two anchors in opposite orders', () => {
    // A settles reliably but slowly; B is fast and unreliable.
    const reliableSlow = { fillRate: 1.0, slippage: 0.0, settleSeconds: 300 };
    const fastUnreliable = { fillRate: 0.3, slippage: 0.0, settleSeconds: 30 };

    // Published: 1.0 vs 3.0 — speed is unbounded, so B wins.
    expect(composite(fastUnreliable)).toBeGreaterThan(composite(reliableSlow));

    const reliableScore = weightedComposite(
      reliableSlow.fillRate,
      reliableSlow.settleSeconds,
      reliableSlow.slippage
    );
    const fastScore = weightedComposite(
      fastUnreliable.fillRate,
      fastUnreliable.settleSeconds,
      fastUnreliable.slippage
    );

    // Weighted: 0.70 vs 0.69 — the speed term is capped, so A wins.
    //
    // This is the concrete cost of the divergence: the leaderboard and the
    // on-chain oracle can put the same two anchors in opposite orders.
    expect(reliableScore).toBeGreaterThan(fastScore);
  });
});
