import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeNextExecutionAt,
  isDue,
  isStopDatePassed,
  isMaxCyclesReached,
  isValidCadence,
} from '@/lib/recurring/cadence';
import type { Cadence } from '@/types/recurring';

// ─── Named cadences ───────────────────────────────────────────────────────────

describe('computeNextExecutionAt — named cadences', () => {
  it('daily: computes next execution 24 hours later', () => {
    const after = new Date('2026-07-01T12:00:00Z');
    const next = computeNextExecutionAt('daily', after);
    expect(next.toISOString()).toBe('2026-07-02T12:00:00.000Z');
  });

  it('weekly: computes next execution 7 days later', () => {
    const after = new Date('2026-07-01T12:00:00Z');
    const next = computeNextExecutionAt('weekly', after);
    expect(next.toISOString()).toBe('2026-07-08T12:00:00.000Z');
  });

  it('biweekly: computes next execution 14 days later', () => {
    const after = new Date('2026-07-01T12:00:00Z');
    const next = computeNextExecutionAt('biweekly', after);
    expect(next.toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('monthly: computes next execution ~30 days later', () => {
    const after = new Date('2026-07-01T12:00:00Z');
    const next = computeNextExecutionAt('monthly', after);
    // 30 days = 2,592,000,000 ms
    const delta = next.getTime() - after.getTime();
    expect(delta).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('daily with startAt: aligns to the start time', () => {
    const startAt = new Date('2026-07-01T08:00:00Z');
    const after = new Date('2026-07-05T12:00:00Z'); // 4.17 days later

    const next = computeNextExecutionAt('daily', after, startAt);
    // Should be 5 days from startAt (2026-07-06T08:00:00Z)
    expect(next.toISOString()).toBe('2026-07-06T08:00:00.000Z');
  });

  it('weekly with startAt: aligns to the start day', () => {
    const startAt = new Date('2026-07-01T08:00:00Z'); // Wednesday
    const after = new Date('2026-07-10T12:00:00Z'); // Friday, 9.17 days later

    const next = computeNextExecutionAt('weekly', after, startAt);
    // Should be 14 days from startAt = 2026-07-15 (Wednesday)
    expect(next.toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });
});

// ─── Cron cadences ───────────────────────────────────────────────────────────

describe('computeNextExecutionAt — cron expressions', () => {
  it('daily at 9 AM: "0 9 * * *"', () => {
    const after = new Date('2026-07-01T08:00:00Z');
    const next = computeNextExecutionAt('0 9 * * *', after);
    expect(next.toISOString()).toBe('2026-07-01T09:00:00.000Z');
  });

  it('daily at 9 AM: after 9 AM moves to next day', () => {
    const after = new Date('2026-07-01T10:00:00Z');
    const next = computeNextExecutionAt('0 9 * * *', after);
    expect(next.toISOString()).toBe('2026-07-02T09:00:00.000Z');
  });

  it('first of month at midnight: "0 0 1 * *"', () => {
    const after = new Date('2026-07-15T12:00:00Z');
    const next = computeNextExecutionAt('0 0 1 * *', after);
    expect(next.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('every Monday at 10: "0 10 * * 1"', () => {
    // 2026-07-01 is a Wednesday. Next Monday is 2026-07-06.
    const after = new Date('2026-07-01T00:00:00Z');
    const next = computeNextExecutionAt('0 10 * * 1', after);
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getUTCHours()).toBe(10);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it('every 15 minutes: "*/15 * * * *"', () => {
    const after = new Date('2026-07-01T12:03:00Z');
    const next = computeNextExecutionAt('*/15 * * * *', after);
    expect(next.toISOString()).toBe('2026-07-01T12:15:00.000Z');
  });

  it('handles end-of-month cron correctly', () => {
    // Last day of month does not work in simple 5-field cron, so use 28th
    const after = new Date('2026-07-01T12:00:00Z');
    const next = computeNextExecutionAt('0 0 28 * *', after);
    expect(next.toISOString()).toBe('2026-07-28T00:00:00.000Z');
  });
});

// ─── isDue ────────────────────────────────────────────────────────────────────

describe('isDue', () => {
  it('returns true when now is after nextExecutionAt', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(isDue(past)).toBe(true);
  });

  it('returns true when now equals nextExecutionAt', () => {
    const now = new Date();
    expect(isDue(now)).toBe(true);
  });

  it('returns false when nextExecutionAt is in the future', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    expect(isDue(future)).toBe(false);
  });

  it('accepts Date objects', () => {
    const past = new Date(Date.now() - 60000);
    expect(isDue(past)).toBe(true);
  });
});

// ─── isStopDatePassed ─────────────────────────────────────────────────────────

describe('isStopDatePassed', () => {
  it('returns true when stop date is in the past', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(isStopDatePassed(past)).toBe(true);
  });

  it('returns false when stop date is in the future', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(isStopDatePassed(future)).toBe(false);
  });

  it('returns false when stopDate is undefined', () => {
    expect(isStopDatePassed(undefined)).toBe(false);
  });
});

// ─── isMaxCyclesReached ───────────────────────────────────────────────────────

describe('isMaxCyclesReached', () => {
  it('returns true when executedCycles >= maxCycles', () => {
    expect(isMaxCyclesReached(5, 5)).toBe(true);
    expect(isMaxCyclesReached(6, 5)).toBe(true);
  });

  it('returns false when executedCycles < maxCycles', () => {
    expect(isMaxCyclesReached(3, 5)).toBe(false);
  });

  it('returns false when maxCycles is undefined (unbounded)', () => {
    expect(isMaxCyclesReached(100, undefined)).toBe(false);
  });
});

// ─── isValidCadence ───────────────────────────────────────────────────────────

describe('isValidCadence', () => {
  it('returns true for named cadences', () => {
    expect(isValidCadence('daily')).toBe(true);
    expect(isValidCadence('weekly')).toBe(true);
    expect(isValidCadence('biweekly')).toBe(true);
    expect(isValidCadence('monthly')).toBe(true);
  });

  it('returns true for valid cron expressions', () => {
    expect(isValidCadence('0 9 * * *')).toBe(true);
    expect(isValidCadence('*/15 * * * *')).toBe(true);
    expect(isValidCadence('0 0 1 * *')).toBe(true);
    expect(isValidCadence('30 14 15 6 3')).toBe(true);
  });

  it('returns false for invalid cadences', () => {
    expect(isValidCadence('hourly')).toBe(false);
    expect(isValidCadence('invalid cron')).toBe(false);
    expect(isValidCadence('')).toBe(false);
  });
});
