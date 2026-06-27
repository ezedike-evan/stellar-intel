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

  it('performance: 10000 events processed under 100ms', () => {
    const events = makeEvents(10000, 'anchor-1', 90);
    const start = performance.now();
    computeWindowAggregate(events, 'anchor-1', 90);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
