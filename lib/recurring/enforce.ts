import {
  type StandingAuthorizationTerms,
  type StandingAuthorizationPeriod,
  type PeriodWindow,
  type ExecutionRecord,
} from '@/types/recurring';
import { parseDecimal } from './scheduler';

export function formatScaledDecimal(val: bigint): string {
  const sign = val < 0n ? '-' : '';
  const abs = val < 0n ? -val : val;
  const intPart = abs / 10000000n;
  const fracPart = abs % 10000000n;
  if (fracPart === 0n) {
    return `${sign}${intPart.toString()}`;
  }
  const fracStr = fracPart.toString().padStart(7, '0').replace(/0+$/, '');
  return `${sign}${intPart.toString()}.${fracStr}`;
}

export function periodWindow(
  period: StandingAuthorizationPeriod,
  timestampMs: number,
  startDateIso: string
): PeriodWindow {
  const startEpoch = new Date(startDateIso).getTime();

  if (period === 'daily') {
    const dayMs = 24 * 60 * 60 * 1000;
    const diff = timestampMs - startEpoch;
    const cycle = Math.floor(diff / dayMs);
    const startMs = startEpoch + cycle * dayMs;
    return { startMs, endMs: startMs + dayMs };
  }

  if (period === 'weekly') {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const diff = timestampMs - startEpoch;
    const cycle = Math.floor(diff / weekMs);
    const startMs = startEpoch + cycle * weekMs;
    return { startMs, endMs: startMs + weekMs };
  }

  // monthly: calendar month aligned with startDate's day-of-month UTC
  const targetDate = new Date(timestampMs);
  const startAnchor = new Date(startDateIso);
  const dom = startAnchor.getUTCDate();

  let curStart = Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), dom);
  if (curStart > timestampMs) {
    curStart = Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth() - 1, dom);
  }
  const nextMonthDate = new Date(curStart);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  return { startMs: curStart, endMs: nextMonthDate.getTime() };
}

export function remainingCapForPeriod(
  terms: StandingAuthorizationTerms,
  executions: ExecutionRecord[],
  timestampMs: number = Date.now()
): { window: PeriodWindow; totalSpent: string; remainingCap: string } {
  const window = periodWindow(terms.period, timestampMs, terms.startDate);
  const capScaled = parseDecimal(terms.perPeriodCap);

  let spentScaled = 0n;
  for (const ex of executions) {
    if (ex.status !== 'confirmed') continue;
    const exTime = new Date(ex.executedAt).getTime();
    if (exTime >= window.startMs && exTime < window.endMs) {
      spentScaled += parseDecimal(ex.amount);
    }
  }

  const remainingScaled = capScaled - spentScaled > 0n ? capScaled - spentScaled : 0n;
  return {
    window,
    totalSpent: formatScaledDecimal(spentScaled),
    remainingCap: formatScaledDecimal(remainingScaled),
  };
}

export type ExecutionCheckCode =
  | 'CORRIDOR_MISMATCH'
  | 'ANCHOR_NOT_ALLOWED'
  | 'AMOUNT_MISMATCH'
  | 'STOP_DATE_EXCEEDED'
  | 'CAP_EXCEEDED'
  | 'BEFORE_START_DATE';

export type ExecutionCheckResult =
  | { ok: true; window: PeriodWindow; remainingAfter: string }
  | { ok: false; code: ExecutionCheckCode; message: string };

export function checkExecutionAgainstAuthorization(params: {
  terms: StandingAuthorizationTerms;
  corridorId: string;
  anchorId: string;
  amount: string;
  executions: ExecutionRecord[];
  timestampMs?: number;
}): ExecutionCheckResult {
  const now = params.timestampMs ?? Date.now();
  const { terms, corridorId, anchorId, amount, executions } = params;

  if (now < new Date(terms.startDate).getTime()) {
    return {
      ok: false,
      code: 'BEFORE_START_DATE',
      message: `Execution timestamp is before authorization startDate (${terms.startDate})`,
    };
  }

  if (terms.stopDate && now > new Date(terms.stopDate).getTime()) {
    return {
      ok: false,
      code: 'STOP_DATE_EXCEEDED',
      message: `Standing authorization expired on stopDate (${terms.stopDate})`,
    };
  }

  if (terms.corridorId !== corridorId) {
    return {
      ok: false,
      code: 'CORRIDOR_MISMATCH',
      message: `Authorized corridor ${terms.corridorId} does not match requested ${corridorId}`,
    };
  }

  if (!terms.anchorAllowlist.includes(anchorId)) {
    return {
      ok: false,
      code: 'ANCHOR_NOT_ALLOWED',
      message: `Anchor ${anchorId} is not in authorized allowlist: [${terms.anchorAllowlist.join(', ')}]`,
    };
  }

  const requestedScaled = parseDecimal(amount);
  const authAmountScaled = parseDecimal(terms.amount);
  if (requestedScaled > authAmountScaled) {
    return {
      ok: false,
      code: 'AMOUNT_MISMATCH',
      message: `Requested amount ${amount} exceeds per-execution authorized amount ${terms.amount}`,
    };
  }

  const { window, remainingCap } = remainingCapForPeriod(terms, executions, now);
  const remainingScaled = parseDecimal(remainingCap);
  if (requestedScaled > remainingScaled) {
    return {
      ok: false,
      code: 'CAP_EXCEEDED',
      message: `Requested amount ${amount} exceeds remaining period cap ${remainingCap}`,
    };
  }

  const remainingAfter = formatScaledDecimal(remainingScaled - requestedScaled);
  return {
    ok: true,
    window,
    remainingAfter,
  };
}
