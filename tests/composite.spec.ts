import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { composite, NORM_SETTLE_SECONDS, MIN_SETTLE_SECONDS } from '@/lib/reputation/composite';

describe('composite', () => {
  it('exports NORM_SETTLE_SECONDS as a positive number', () => {
    expect(NORM_SETTLE_SECONDS).toBeGreaterThan(0);
  });

  it('exports MIN_SETTLE_SECONDS as a positive number', () => {
    expect(MIN_SETTLE_SECONDS).toBeGreaterThan(0);
  });

  it('returns 1.0 for perfect metrics at reference settle time', () => {
    const score = composite({ fillRate: 1, slippage: 0, settleSeconds: NORM_SETTLE_SECONDS });
    expect(score).toBeCloseTo(1.0);
  });

  it('returns 0 for fillRate of 0', () => {
    const score = composite({ fillRate: 0, slippage: 0, settleSeconds: NORM_SETTLE_SECONDS });
    expect(score).toBe(0);
  });

  it('returns 0 for slippage of 1 (100%)', () => {
    const score = composite({ fillRate: 1, slippage: 1, settleSeconds: NORM_SETTLE_SECONDS });
    expect(score).toBe(0);
  });

  it('increases as fillRate increases', () => {
    const base = { slippage: 0.01, settleSeconds: NORM_SETTLE_SECONDS };
    const low = composite({ fillRate: 0.7, ...base });
    const high = composite({ fillRate: 0.9, ...base });
    expect(high).toBeGreaterThan(low);
  });

  it('decreases as slippage increases', () => {
    const base = { fillRate: 0.95, settleSeconds: NORM_SETTLE_SECONDS };
    const low = composite({ slippage: 0.005, ...base });
    const high = composite({ slippage: 0.02, ...base });
    expect(low).toBeGreaterThan(high);
  });

  it('increases as settleSeconds decreases (faster is better)', () => {
    const base = { fillRate: 0.95, slippage: 0.01 };
    const fast = composite({ settleSeconds: NORM_SETTLE_SECONDS / 2, ...base });
    const slow = composite({ settleSeconds: NORM_SETTLE_SECONDS * 2, ...base });
    expect(fast).toBeGreaterThan(slow);
  });

  it('matches documented formula: fillRate × (1 - slippage) / (settleSeconds / NORM)', () => {
    const metrics = { fillRate: 0.95, slippage: 0.011, settleSeconds: 1320 };
    const expected = (0.95 * (1 - 0.011)) / (1320 / NORM_SETTLE_SECONDS);
    expect(composite(metrics)).toBeCloseTo(expected, 10);
  });

  it('handles settleSeconds of 0 without throwing (clamped to MIN)', () => {
    expect(() => composite({ fillRate: 0.9, slippage: 0.01, settleSeconds: 0 })).not.toThrow();
    const score = composite({ fillRate: 0.9, slippage: 0.01, settleSeconds: 0 });
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it('is deterministic — same inputs always produce the same output', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 86400, noNaN: true }),
        (fillRate, slippage, settleSeconds) => {
          const a = composite({ fillRate, slippage, settleSeconds });
          const b = composite({ fillRate, slippage, settleSeconds });
          return a === b;
        }
      ),
      { numRuns: 500 }
    );
  });

  it('result is always finite for valid inputs', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        fc.double({ min: 1, max: 86400, noNaN: true }),
        (fillRate, slippage, settleSeconds) => {
          return Number.isFinite(composite({ fillRate, slippage, settleSeconds }));
        }
      ),
      { numRuns: 1000 }
    );
  });
});
