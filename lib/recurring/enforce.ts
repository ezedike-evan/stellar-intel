/**
 * lib/recurring/enforce.ts
 *
 * Server-side limits on a standing authorization (REC003): the per-period cap,
 * the start and stop dates, and the anchor allowlist. Pure: no store, no clock
 * reads. Amounts are compared as 7-dp scaled BigInts, never as floats.
 */
import type { StandingAuthorizationStatus, StandingAuthorizationTerms } from '@/types/recurring';
import { parseDecimal } from './scheduler';

const SCALE = 10_000_000n;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_PERIOD_MS = { daily: DAY_MS, weekly: 7 * DAY_MS, biweekly: 14 * DAY_MS } as const;

/** The inverse of parseDecimal: 7 dp, trailing zeros and a trailing "." trimmed. */
export function formatScaledDecimal(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(7, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export interface PeriodWindow {
  index: number;
  start: Date;
  end: Date;
}

type WindowTerms = Pick<StandingAuthorizationTerms, 'period' | 'startAt' | 'stopAt'>;

function monthIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthStart(monthIdx: number): number {
  return Date.UTC(Math.floor(monthIdx / 12), monthIdx % 12, 1);
}

/**
 * The period window containing `at`, or null outside [startAt, stopAt).
 * Daily, weekly and biweekly windows are fixed lengths counted from startAt.
 * Monthly windows are UTC calendar months: window 0 starts at startAt, later
 * ones at 00:00 UTC on the 1st. `end` is the next window's start, capped at stopAt.
 */
export function periodWindow(terms: WindowTerms, at: Date): PeriodWindow | null {
  const startMs = Date.parse(terms.startAt);
  const stopMs = Date.parse(terms.stopAt);
  const atMs = at.getTime();
  if (atMs < startMs || atMs >= stopMs) return null;

  if (terms.period === 'monthly') {
    const first = monthIndex(new Date(startMs));
    const index = monthIndex(at) - first;
    const start = index === 0 ? startMs : monthStart(first + index);
    const end = Math.min(monthStart(first + index + 1), stopMs);
    return { index, start: new Date(start), end: new Date(end) };
  }

  const len = FIXED_PERIOD_MS[terms.period];
  const index = Math.floor((atMs - startMs) / len);
  const start = startMs + index * len;
  return { index, start: new Date(start), end: new Date(Math.min(start + len, stopMs)) };
}

function inWindow(window: PeriodWindow, iso: string): boolean {
  const t = Date.parse(iso);
  return t >= window.start.getTime() && t < window.end.getTime();
}

function spentInWindow(window: PeriodWindow, prior: Array<{ amount: string; at: string }>): bigint {
  return prior.reduce(
    (sum, p) => (inWindow(window, p.at) ? sum + parseDecimal(p.amount) : sum),
    0n
  );
}

/** perPeriodCap minus what `prior` spent in the window containing `at`, floored at '0'. */
export function remainingCapForPeriod(
  terms: StandingAuthorizationTerms,
  prior: Array<{ amount: string; at: string }>,
  at: Date
): string {
  const window = periodWindow(terms, at);
  if (!window) return '0';
  const remaining = parseDecimal(terms.perPeriodCap) - spentInWindow(window, prior);
  return formatScaledDecimal(remaining > 0n ? remaining : 0n);
}

export type ExecutionCheckCode =
  | 'not_started'
  | 'stop_date_passed'
  | 'authorization_inactive'
  | 'corridor_mismatch'
  | 'asset_mismatch'
  | 'anchor_not_allowed'
  | 'period_cap_exceeded';

export interface ProposedExecution {
  corridorId: string;
  sourceAsset: string;
  destinationAsset: string;
  anchorId: string;
  amount: string;
  at: Date;
}

/**
 * Checks one proposed execution against a standing authorization. `prior`
 * must only hold confirmed executions; the caller filters.
 */
export function checkExecutionAgainstAuthorization(input: {
  terms: StandingAuthorizationTerms;
  status: StandingAuthorizationStatus;
  prior: Array<{ amount: string; at: string }>;
  proposed: ProposedExecution;
}):
  | { ok: true; window: PeriodWindow; remainingAfter: string }
  | { ok: false; code: ExecutionCheckCode; message: string } {
  const { terms, status, prior, proposed } = input;
  const fail = (code: ExecutionCheckCode, message: string) => ({
    ok: false as const,
    code,
    message,
  });
  const atMs = proposed.at.getTime();

  if (status !== 'active') return fail('authorization_inactive', `The standing order is ${status}`);
  if (atMs < Date.parse(terms.startAt)) {
    return fail('not_started', 'The standing order has not started yet');
  }
  if (atMs >= Date.parse(terms.stopAt)) {
    return fail('stop_date_passed', 'The standing order has passed its stop date');
  }
  if (proposed.corridorId.toLowerCase() !== terms.corridorId.toLowerCase()) {
    return fail('corridor_mismatch', 'The corridor does not match the standing order');
  }
  if (
    proposed.sourceAsset.toLowerCase() !== terms.sourceAsset.toLowerCase() ||
    proposed.destinationAsset.toLowerCase() !== terms.destinationAsset.toLowerCase()
  ) {
    return fail('asset_mismatch', 'The assets do not match the standing order');
  }
  if (!terms.anchorAllowlist.includes(proposed.anchorId)) {
    return fail('anchor_not_allowed', 'That anchor is not on the standing order allowlist');
  }

  const window = periodWindow(terms, proposed.at);
  if (!window) return fail('stop_date_passed', 'The standing order has passed its stop date');
  const spent = spentInWindow(window, prior) + parseDecimal(proposed.amount);
  const cap = parseDecimal(terms.perPeriodCap);
  if (spent > cap) {
    return fail('period_cap_exceeded', 'This payment would exceed the per-period cap');
  }
  return { ok: true, window, remainingAfter: formatScaledDecimal(cap - spent) };
}
