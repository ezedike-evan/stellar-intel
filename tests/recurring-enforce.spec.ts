import { describe, expect, it } from 'vitest';
import {
  checkExecutionAgainstAuthorization,
  formatScaledDecimal,
  periodWindow,
  remainingCapForPeriod,
} from '@/lib/recurring/enforce';
import { parseDecimal } from '@/lib/recurring/scheduler';
import type { StandingAuthorizationTerms } from '@/types/recurring';

const terms = (
  overrides: Partial<StandingAuthorizationTerms> = {}
): StandingAuthorizationTerms => ({
  type: 'recurring-authorization',
  version: 1,
  sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  corridorId: 'usdc-ngn',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '50',
  perPeriodCap: '100',
  period: 'weekly',
  startAt: '2026-01-01T00:00:00.000Z',
  stopAt: '2026-12-31T00:00:00.000Z',
  anchorAllowlist: ['cowrie', 'moneygram'],
  nonce: '0123456789abcdef0123456789abcdef',
  ...overrides,
});

const proposed = (overrides: Record<string, unknown> = {}) => ({
  corridorId: 'usdc-ngn',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  anchorId: 'cowrie',
  amount: '50',
  at: new Date('2026-01-03T00:00:00.000Z'),
  ...overrides,
});

const at = (iso: string) => new Date(iso);

describe('formatScaledDecimal (#2167)', () => {
  it.each(['0', '100', '0.0000001', '123.45'])('round-trips %s with parseDecimal', (v) => {
    expect(formatScaledDecimal(parseDecimal(v))).toBe(v);
  });

  it('trims trailing zeros', () => {
    expect(formatScaledDecimal(1_000_000_000n)).toBe('100');
    expect(formatScaledDecimal(1_234_500n)).toBe('0.12345');
  });
});

describe('periodWindow', () => {
  it('counts daily windows from startAt', () => {
    const t = terms({ period: 'daily' });
    expect(periodWindow(t, at('2026-01-01T00:00:00.000Z'))?.index).toBe(0);
    expect(periodWindow(t, at('2026-01-01T23:59:59.999Z'))?.index).toBe(0);
    expect(periodWindow(t, at('2026-01-02T00:00:00.000Z'))?.index).toBe(1);
    expect(periodWindow(t, at('2026-01-03T12:00:00.000Z'))?.index).toBe(2);
  });

  it('counts weekly windows of seven days', () => {
    const w = periodWindow(terms(), at('2026-01-08T00:00:00.000Z'));
    expect(w?.index).toBe(1);
    expect(w?.start.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(w?.end.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('uses UTC calendar months, starting the next month on the 1st', () => {
    const t = terms({ period: 'monthly', startAt: '2026-01-31T00:00:00.000Z' });
    const jan = periodWindow(t, at('2026-01-31T12:00:00.000Z'));
    expect(jan?.index).toBe(0);
    expect(jan?.end.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    const feb = periodWindow(t, at('2026-02-10T00:00:00.000Z'));
    expect(feb?.index).toBe(1);
    expect(feb?.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('is null before the start and at the stop', () => {
    expect(periodWindow(terms(), at('2025-12-31T23:59:59.999Z'))).toBeNull();
    expect(periodWindow(terms(), at('2026-12-31T00:00:00.000Z'))).toBeNull();
  });

  it('caps the last window at stopAt', () => {
    const t = terms({ stopAt: '2026-01-10T00:00:00.000Z' });
    expect(periodWindow(t, at('2026-01-09T00:00:00.000Z'))?.end.toISOString()).toBe(
      '2026-01-10T00:00:00.000Z'
    );
  });
});

describe('checkExecutionAgainstAuthorization', () => {
  const run = (
    overrides: Record<string, unknown> = {},
    extra: Partial<Parameters<typeof checkExecutionAgainstAuthorization>[0]> = {}
  ) =>
    checkExecutionAgainstAuthorization({
      terms: terms(),
      status: 'active',
      prior: [],
      proposed: proposed(overrides),
      ...extra,
    });

  it('accepts an execution inside every limit', () => {
    expect(run()).toMatchObject({ ok: true, remainingAfter: '50' });
  });

  it.each([
    ['authorization_inactive', {}, { status: 'paused' as const }],
    ['not_started', { at: at('2025-12-30T00:00:00.000Z') }, {}],
    ['stop_date_passed', { at: at('2027-01-01T00:00:00.000Z') }, {}],
    ['corridor_mismatch', { corridorId: 'usdc-kes' }, {}],
    ['asset_mismatch', { destinationAsset: 'KES' }, {}],
    ['anchor_not_allowed', { anchorId: 'bitso' }, {}],
    ['period_cap_exceeded', { amount: '100.0000001' }, {}],
  ])('reports %s', (code, overrides, extra) => {
    expect(run(overrides, extra)).toMatchObject({ ok: false, code });
  });

  it('only counts prior executions in the same window', () => {
    const prior = [
      { amount: '90', at: '2025-12-31T00:00:00.000Z' }, // before start, never in a window
      { amount: '80', at: '2026-01-05T00:00:00.000Z' }, // week 0 (Jan 1-7)
    ];
    expect(run({ at: at('2026-01-09T00:00:00.000Z') }, { prior })).toMatchObject({ ok: true });
    expect(run({ at: at('2026-01-06T00:00:00.000Z') }, { prior })).toMatchObject({
      ok: false,
      code: 'period_cap_exceeded',
    });
  });

  it('allows exactly the cap and refuses one stroop more', () => {
    const prior = [{ amount: '60', at: '2026-01-02T00:00:00.000Z' }];
    expect(run({ amount: '40' }, { prior })).toMatchObject({ ok: true, remainingAfter: '0' });
    expect(run({ amount: '40.0000001' }, { prior })).toMatchObject({
      ok: false,
      code: 'period_cap_exceeded',
    });
  });

  it('reports the remaining cap for the period', () => {
    const prior = [{ amount: '30.5', at: '2026-01-02T00:00:00.000Z' }];
    expect(remainingCapForPeriod(terms(), prior, at('2026-01-03T00:00:00.000Z'))).toBe('69.5');
    expect(remainingCapForPeriod(terms(), prior, at('2026-01-09T00:00:00.000Z'))).toBe('100');
  });
});
