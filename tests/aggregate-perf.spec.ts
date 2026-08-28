import { describe, it, expect } from 'vitest';
import {
  computeWindowAggregate,
  incrementalUpdate,
  type SettlementEvent,
} from '@/lib/reputation/aggregate';

function makeEvents(count: number, anchorId = 'anchor-1', daysBack = 7): SettlementEvent[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    anchorId,
    corridor: 'usdc-ngn',
    completedAt: new Date(now - (i % daysBack) * 86400000),
    settlementMs: 120000 + i * 1000,
    success: i % 10 !== 0,
  }));
}

describe('computeWindowAggregate', () => {
  it('returns null composite for empty events', () => {
    const result = computeWindowAggregate([], 'anchor-1', 7);
    expect(result.compositeScore).toBeNull();
    expect(result.txCount).toBe(0);
  });

  it('7-day window only includes recent events', () => {
    const old: SettlementEvent = {
      anchorId: 'anchor-1',
      corridor: 'usdc-ngn',
      completedAt: new Date(Date.now() - 10 * 86400000),
      settlementMs: 60000,
      success: true,
    };
    const recent: SettlementEvent = {
      anchorId: 'anchor-1',
      corridor: 'usdc-ngn',
      completedAt: new Date(Date.now() - 2 * 86400000),
      settlementMs: 60000,
      success: true,
    };
    const result = computeWindowAggregate([old, recent], 'anchor-1', 7);
    expect(result.txCount).toBe(1);
  });

  it('30-day window includes events within 30 days', () => {
    const events = makeEvents(20, 'anchor-1', 30);
    const result = computeWindowAggregate(events, 'anchor-1', 30);
    expect(result.txCount).toBe(20);
  });

  it('composite score is between 0 and 1', () => {
    const events = makeEvents(50);
    const result = computeWindowAggregate(events, 'anchor-1', 7);
    expect(result.compositeScore).not.toBeNull();
    expect(result.compositeScore!).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore!).toBeLessThanOrEqual(1);
  });

  it('incremental update increases tx count', () => {
    const events = makeEvents(10);
    const base = computeWindowAggregate(events, 'anchor-1', 7);
    const updated = incrementalUpdate(base, {
      anchorId: 'anchor-1',
      corridor: 'usdc-ngn',
      completedAt: new Date(),
      settlementMs: 90000,
      success: true,
    });
    expect(updated.txCount).toBe(base.txCount + 1);
  });

  it('processes 10000 events without dropping any', () => {
    const events = makeEvents(10000, 'anchor-1', 90);
    const result = computeWindowAggregate(events, 'anchor-1', 90);

    expect(result.txCount).toBe(10000);
    expect(result.compositeScore).not.toBeNull();
    expect(result.compositeScore!).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore!).toBeLessThanOrEqual(1);
  });

  // This replaces a `performance.now()` budget of 100ms, which measured the
  // machine rather than the code (#947). On a loaded runner it read 361ms and
  // 513ms while passing in isolation every time, so it redded CI on changes to
  // legal copy, oracle reads, and routing.
  //
  // A ratio survives that. `computeWindowAggregate` sorts, so cost is n log n:
  // a 10x input is ~10x linear, ~11.5x for n log n, and ~100x if someone
  // rewrites the sort into a nested loop. 40 sits in the gap with room on both
  // sides, and dividing one timing by another cancels the constant factor —
  // whether that factor is a busy CPU, a cold JIT, or V8 coverage
  // instrumentation, it applies to both measurements.
  it('scales sub-quadratically with event count', () => {
    const REPS = 5;

    const timeOnce = (count: number): number => {
      const events = makeEvents(count, 'anchor-1', 90);
      const start = performance.now();
      computeWindowAggregate(events, 'anchor-1', 90);
      return performance.now() - start;
    };

    // Minimum, not mean: a scheduler preemption can only ever make a sample
    // slower, so the fastest run is the closest estimate of the real cost.
    const best = (count: number): number =>
      Math.min(...Array.from({ length: REPS }, () => timeOnce(count)));

    const small = best(2_000);
    const large = best(20_000);

    // Guard against a floor of 0 on a fast machine, which would make the
    // ratio Infinity and fail for the wrong reason.
    const ratio = large / Math.max(small, 0.01);

    expect(ratio).toBeLessThan(40);
  });
});
