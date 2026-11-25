import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { nearestRankPercentile } from '@/lib/reputation/percentile';
import { percentile } from '@/lib/reputation/store';

describe('nearestRankPercentile', () => {
  it('returns null on an empty array and the single value on [7]', () => {
    expect(nearestRankPercentile([], 0)).toBeNull();
    expect(nearestRankPercentile([], 50)).toBeNull();
    expect(nearestRankPercentile([], 100)).toBeNull();

    expect(nearestRankPercentile([7], 0)).toBe(7);
    expect(nearestRankPercentile([7], 50)).toBe(7);
    expect(nearestRankPercentile([7], 100)).toBe(7);
  });

  it('computes expected nearest-rank percentiles for [1..10]', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(nearestRankPercentile(values, 0)).toBe(1);
    expect(nearestRankPercentile(values, 50)).toBe(5);
    expect(nearestRankPercentile(values, 90)).toBe(9);
    expect(nearestRankPercentile(values, 95)).toBe(10);
    expect(nearestRankPercentile(values, 100)).toBe(10);
  });

  it('does not mutate the input array', () => {
    const input = Object.freeze([2, 4, 6, 8]);
    expect(nearestRankPercentile(input, 50)).toBe(4);
    expect(input).toEqual([2, 4, 6, 8]);
  });

  it('throws RangeError for non-finite or out-of-range p values', () => {
    for (const bad of [
      -1,
      100.0001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => nearestRankPercentile([1, 2, 3], bad)).toThrow(RangeError);
    }
  });

  it('satisfies membership, monotonicity, and max-at-100 invariants via property testing', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (raw, p1, p2) => {
          const sorted = [...raw].sort((a, b) => a - b);
          const lowP = Math.min(p1, p2);
          const highP = Math.max(p1, p2);

          const lowVal = nearestRankPercentile(sorted, lowP);
          const highVal = nearestRankPercentile(sorted, highP);
          const maxVal = nearestRankPercentile(sorted, 100);

          expect(lowVal).not.toBeNull();
          expect(highVal).not.toBeNull();
          expect(sorted).toContain(lowVal);
          expect(sorted).toContain(highVal);
          expect(lowVal!).toBeLessThanOrEqual(highVal!);
          expect(maxVal).toBe(sorted[sorted.length - 1]);
        }
      )
    );
  });

  it('keeps store.percentile delegating identically for sorted input', () => {
    const sorted = [3, 1, 2].sort((a, b) => a - b);
    expect(percentile(sorted, 50)).toBe(nearestRankPercentile(sorted, 50));
    expect(percentile(sorted, 95)).toBe(nearestRankPercentile(sorted, 95));
  });
});
