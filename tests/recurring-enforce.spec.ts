import { describe, it, expect } from 'vitest';
import {
  formatScaledDecimal,
  periodWindow,
  remainingCapForPeriod,
  checkExecutionAgainstAuthorization,
  parseDecimal,
  type StandingAuthorizationTerms,
} from '@/lib/recurring';

const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const TERMS: StandingAuthorizationTerms = {
  type: 'recurring-authorization',
  version: 1,
  sender: SENDER,
  corridorId: 'usdc-ngn',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  perPeriodCap: '250',
  period: 'daily',
  startAt: '2026-11-20T00:00:00.000Z',
  stopAt: '2026-11-23T00:00:00.000Z',
  anchorAllowlist: ['moneygram'],
  nonce: '0123456789abcdef0123456789abcdef',
};

describe('recurring-enforce', () => {
  it('formatScaledDecimal round-trips with parseDecimal', () => {
    for (const val of ['0', '100', '0.0000001', '123.45']) {
      expect(formatScaledDecimal(parseDecimal(val))).toBe(val);
    }
  });

  it('computes daily, weekly, and monthly period windows', () => {
    // Daily
    const d0 = periodWindow(TERMS, new Date('2026-11-20T05:00:00Z'));
    expect(d0?.index).toBe(0);
    expect(d0?.start.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(d0?.end.toISOString()).toBe('2026-11-21T00:00:00.000Z');

    const d1 = periodWindow(TERMS, new Date('2026-11-21T00:00:00Z'));
    expect(d1?.index).toBe(1);

    // Stop at boundary is null
    expect(periodWindow(TERMS, new Date('2026-11-23T00:00:00Z'))).toBeNull();
    // Before start is null
    expect(periodWindow(TERMS, new Date('2026-11-19T23:59:59Z'))).toBeNull();

    // Monthly with start on Jan 31
    const monthlyTerms: StandingAuthorizationTerms = {
      ...TERMS,
      period: 'monthly',
      startAt: '2026-01-31T15:00:00.000Z',
      stopAt: '2026-04-30T00:00:00.000Z',
    };
    const m0 = periodWindow(monthlyTerms, new Date('2026-01-31T20:00:00Z'));
    expect(m0?.index).toBe(0);
    expect(m0?.start.toISOString()).toBe('2026-01-31T15:00:00.000Z');
    expect(m0?.end.toISOString()).toBe('2026-02-01T00:00:00.000Z');

    const m1 = periodWindow(monthlyTerms, new Date('2026-02-15T10:00:00Z'));
    expect(m1?.index).toBe(1);
    expect(m1?.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(m1?.end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('remainingCapForPeriod sums only in-window priors and floors at 0', () => {
    const priors = [
      { amount: '100', at: '2026-11-19T10:00:00Z' }, // out of window
      { amount: '50', at: '2026-11-20T02:00:00Z' },  // in window
      { amount: '120', at: '2026-11-20T08:00:00Z' }, // in window (total 170 / cap 250)
    ];

    const rem = remainingCapForPeriod(TERMS, priors, new Date('2026-11-20T12:00:00Z'));
    expect(rem).toBe('80');

    // Over cap
    const overPriors = [
      { amount: '300', at: '2026-11-20T02:00:00Z' },
    ];
    expect(remainingCapForPeriod(TERMS, overPriors, new Date('2026-11-20T12:00:00Z'))).toBe('0');
  });

  it('checkExecutionAgainstAuthorization produces each execution check code', () => {
    const baseProposed = {
      corridorId: 'usdc-ngn',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      anchorId: 'moneygram',
      amount: '50',
      at: new Date('2026-11-20T10:00:00Z'),
    };

    // 1. authorization_inactive
    const resInactive = checkExecutionAgainstAuthorization({
      terms: TERMS,
      status: 'paused',
      prior: [],
      proposed: baseProposed,
    });
    expect(resInactive.ok).toBe(false);
    if (!resInactive.ok) expect(resInactive.code).toBe('authorization_inactive');

    // 2. not_started
    const resNotStarted = checkExecutionAgainstAuthorization({
      terms: TERMS,
      status: 'active',
      prior: [],
      proposed: { ...baseProposed, at: new Date('2026-11-19T10:00:00Z') },
    });
    expect(resNotStarted.ok).toBe(false);
    if (!resNotStarted.ok) expect(resNotStarted.code).toBe('not_started');

    // 3. stop_date_passed
    const resStopped = checkExecutionAgainstAuthorization({
      terms: TERMS,
      status: 'active',
      prior: [],
      proposed: { ...baseProposed, at: new Date('2026-11-23T10:00:00Z') },
    });
    expect(resStopped.ok).toBe(false);
    if (!resStopped.ok) expect(resStopped.code).toBe('stop_date_passed');

    // 4. corridor_mismatch
    const resCorridor = checkExecutionAgainstAuthorization({
      terms: TERMS,
      status: 'active',
      prior: [],
      proposed: { ...baseProposed, corridorId: 'usdc-kes' },
    });
    expect(resCorridor.ok).toBe(false);
    if (!resCorridor.ok) expect(resCorridor.code).toBe('corridor_mismatch');

    // 5. asset_mismatch
    const resAsset = checkExecutionAgainstAuthorization({
      terms: TERMS,
      status: 'active',
      prior: [],
      proposed: { ...baseProposed, sourceAsset: 'XLM' },
    });
    expect(resAsset.ok).toBe(false);
    if (!resAsset.ok) expect(resAsset.code).toBe('asset_mismatch');

    // 6. anchor_not_allowed
    const resAnchor = checkExecutionAgainstAuthorization({
      terms: TERMS,
      status: 'active',
      prior: [],
      proposed: { ...baseProposed, anchorId: 'unauthorized-anchor' },
    });
    expect(resAnchor.ok).toBe(false);
    if (!resAnchor.ok) expect(resAnchor.code).toBe('anchor_not_allowed');

    // 7. period_cap_exceeded
    const resCap = checkExecutionAgainstAuthorization({
      terms: TERMS,
      status: 'active',
      prior: [{ amount: '200', at: '2026-11-20T05:00:00Z' }],
      proposed: { ...baseProposed, amount: '50.0000001' },
    });
    expect(resCap.ok).toBe(false);
    if (!resCap.ok) expect(resCap.code).toBe('period_cap_exceeded');

    // Exact cap passes
    const resExact = checkExecutionAgainstAuthorization({
      terms: TERMS,
      status: 'active',
      prior: [{ amount: '200', at: '2026-11-20T05:00:00Z' }],
      proposed: { ...baseProposed, amount: '50' },
    });
    expect(resExact.ok).toBe(true);
  });
});
