import { parseDecimal } from './scheduler';
import type {
  StandingAuthorizationTerms,
  StandingAuthorizationStatus,
} from '@/types/recurring';

export function formatScaledDecimal(v: bigint): string {
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const whole = abs / 10000000n;
  const frac = abs % 10000000n;
  if (frac === 0n) return `${sign}${whole}`;
  const fracStr = frac.toString().padStart(7, '0').replace(/0+$/, '');
  return `${sign}${whole}.${fracStr}`;
}

export interface PeriodWindow {
  index: number;
  start: Date;
  end: Date;
}

export function periodWindow(
  terms: Pick<StandingAuthorizationTerms, 'period' | 'startAt' | 'stopAt'>,
  at: Date
): PeriodWindow | null {
  const startAt = new Date(terms.startAt);
  const stopAt = new Date(terms.stopAt);

  if (at.getTime() < startAt.getTime() || at.getTime() >= stopAt.getTime()) {
    return null;
  }

  if (terms.period === 'monthly') {
    const index =
      (at.getUTCFullYear() - startAt.getUTCFullYear()) * 12 +
      (at.getUTCMonth() - startAt.getUTCMonth());

    const start =
      index === 0
        ? startAt
        : new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth() + index, 1, 0, 0, 0, 0));

    const nextMonth = new Date(
      Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth() + index + 1, 1, 0, 0, 0, 0)
    );
    const end = nextMonth.getTime() > stopAt.getTime() ? stopAt : nextMonth;

    return { index, start, end };
  }

  const periodDays = terms.period === 'daily' ? 1 : terms.period === 'weekly' ? 7 : 14;
  const lenMs = periodDays * 86_400_000;

  const index = Math.floor((at.getTime() - startAt.getTime()) / lenMs);
  const start = new Date(startAt.getTime() + index * lenMs);
  const rawEnd = new Date(startAt.getTime() + (index + 1) * lenMs);
  const end = rawEnd.getTime() > stopAt.getTime() ? stopAt : rawEnd;

  return { index, start, end };
}

export function remainingCapForPeriod(
  terms: StandingAuthorizationTerms,
  prior: Array<{ amount: string; at: string }>,
  at: Date
): string {
  const w = periodWindow(terms, at);
  if (!w) return '0';

  const cap = parseDecimal(terms.perPeriodCap);
  let sum = 0n;
  for (const p of prior) {
    const t = new Date(p.at).getTime();
    if (t >= w.start.getTime() && t < w.end.getTime()) {
      sum += parseDecimal(p.amount);
    }
  }

  if (sum >= cap) return '0';
  return formatScaledDecimal(cap - sum);
}

export type ExecutionCheckCode =
  | 'not_started'
  | 'stop_date_passed'
  | 'authorization_inactive'
  | 'corridor_mismatch'
  | 'asset_mismatch'
  | 'anchor_not_allowed'
  | 'period_cap_exceeded';

export function checkExecutionAgainstAuthorization(input: {
  terms: StandingAuthorizationTerms;
  status: StandingAuthorizationStatus;
  prior: Array<{ amount: string; at: string }>;
  proposed: {
    corridorId: string;
    sourceAsset: string;
    destinationAsset: string;
    anchorId: string;
    amount: string;
    at: Date;
  };
}):
  | { ok: true; window: PeriodWindow; remainingAfter: string }
  | { ok: false; code: ExecutionCheckCode; message: string } {
  if (input.status !== 'active') {
    return {
      ok: false,
      code: 'authorization_inactive',
      message: 'Standing authorization is not active.',
    };
  }

  const startAt = new Date(input.terms.startAt);
  const stopAt = new Date(input.terms.stopAt);

  if (input.proposed.at.getTime() < startAt.getTime()) {
    return {
      ok: false,
      code: 'not_started',
      message: 'Authorization start date is in the future.',
    };
  }

  if (input.proposed.at.getTime() >= stopAt.getTime()) {
    return {
      ok: false,
      code: 'stop_date_passed',
      message: 'Authorization stop date has passed.',
    };
  }

  if (input.proposed.corridorId.toLowerCase() !== input.terms.corridorId.toLowerCase()) {
    return {
      ok: false,
      code: 'corridor_mismatch',
      message: 'Proposed corridor does not match authorization.',
    };
  }

  if (
    input.proposed.sourceAsset.toLowerCase() !== input.terms.sourceAsset.toLowerCase() ||
    input.proposed.destinationAsset.toLowerCase() !== input.terms.destinationAsset.toLowerCase()
  ) {
    return {
      ok: false,
      code: 'asset_mismatch',
      message: 'Proposed assets do not match authorization.',
    };
  }

  if (!input.terms.anchorAllowlist.includes(input.proposed.anchorId)) {
    return {
      ok: false,
      code: 'anchor_not_allowed',
      message: `Anchor "${input.proposed.anchorId}" is not in the allowlist.`,
    };
  }

  const w = periodWindow(input.terms, input.proposed.at);
  if (!w) {
    return {
      ok: false,
      code: 'stop_date_passed',
      message: 'Authorization is not currently active.',
    };
  }

  const cap = parseDecimal(input.terms.perPeriodCap);
  let sum = 0n;
  for (const p of input.prior) {
    const t = new Date(p.at).getTime();
    if (t >= w.start.getTime() && t < w.end.getTime()) {
      sum += parseDecimal(p.amount);
    }
  }

  const proposedAmount = parseDecimal(input.proposed.amount);
  if (sum + proposedAmount > cap) {
    return {
      ok: false,
      code: 'period_cap_exceeded',
      message: 'Proposed execution exceeds the per-period cap.',
    };
  }

  const remainingAfter = formatScaledDecimal(cap - (sum + proposedAmount));
  return { ok: true, window: w, remainingAfter };
}
