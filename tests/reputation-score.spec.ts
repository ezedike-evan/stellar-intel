import { describe, it, expect } from 'vitest';
import { getScore } from '@/lib/reputation/score';
import type { SettlementEvent } from '@/lib/reputation/aggregate';

const base = new Date('2024-01-15T12:00:00Z');

function makeEvent(
  anchorId: string,
  success: boolean,
  settlementMs: number,
  offsetMs = 0
): SettlementEvent {
  return {
    anchorId,
    corridor: 'usdc-ngn',
    completedAt: new Date(base.getTime() + offsetMs),
    settlementMs,
    success,
  };
}

describe('getScore', () => {
  it('returns zeros for an anchor with no events', () => {
    const result = getScore('unknown', []);
    expect(result).toEqual({ total: 0, success_rate: 0, last_settle_seconds: 0 });
  });

  it('returns zeros when no events match the anchor', () => {
    const events = [makeEvent('other-anchor', true, 30_000)];
    expect(getScore('my-anchor', events)).toEqual({
      total: 0,
      success_rate: 0,
      last_settle_seconds: 0,
    });
  });

  it('counts all events for the anchor', () => {
    const events = [
      makeEvent('alpha', true, 10_000),
      makeEvent('alpha', false, 20_000),
      makeEvent('alpha', true, 15_000),
      makeEvent('beta', true, 5_000),
    ];
    const result = getScore('alpha', events);
    expect(result.total).toBe(3);
  });

  it('computes correct success_rate', () => {
    const events = [
      makeEvent('anchor', true, 10_000),
      makeEvent('anchor', true, 12_000),
      makeEvent('anchor', false, 8_000),
      makeEvent('anchor', false, 9_000),
    ];
    const result = getScore('anchor', events);
    expect(result.success_rate).toBeCloseTo(0.5);
  });

  it('returns success_rate of 1 when all events succeed', () => {
    const events = [makeEvent('anchor', true, 5_000), makeEvent('anchor', true, 7_000)];
    expect(getScore('anchor', events).success_rate).toBe(1);
  });

  it('returns success_rate of 0 when all events fail', () => {
    const events = [makeEvent('anchor', false, 5_000), makeEvent('anchor', false, 7_000)];
    expect(getScore('anchor', events).success_rate).toBe(0);
  });

  it('reports last_settle_seconds from the most recent event', () => {
    const events = [
      makeEvent('anchor', true, 30_000, 0), // oldest,  30s settle
      makeEvent('anchor', true, 60_000, 5_000), // middle,  60s settle
      makeEvent('anchor', true, 45_000, 10_000), // newest,  45s settle
    ];
    const result = getScore('anchor', events);
    expect(result.last_settle_seconds).toBe(45);
  });

  it('converts settlementMs to seconds correctly', () => {
    const events = [makeEvent('anchor', true, 90_000)];
    expect(getScore('anchor', events).last_settle_seconds).toBe(90);
  });

  it('isolates events by anchorId', () => {
    const events = [
      makeEvent('anchor-a', true, 10_000),
      makeEvent('anchor-b', false, 20_000),
      makeEvent('anchor-a', false, 30_000),
    ];
    const a = getScore('anchor-a', events);
    expect(a.total).toBe(2);
    expect(a.success_rate).toBe(0.5);

    const b = getScore('anchor-b', events);
    expect(b.total).toBe(1);
    expect(b.success_rate).toBe(0);
  });

  it('handles a single event correctly', () => {
    const events = [makeEvent('anchor', true, 120_000)];
    const result = getScore('anchor', events);
    expect(result).toEqual({ total: 1, success_rate: 1, last_settle_seconds: 120 });
  });
});
