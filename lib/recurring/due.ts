import { parseDecimal } from './scheduler';
import { periodWindow, remainingCapForPeriod } from './enforce';
import type { StandingAuthorizationRecord, StandingExecutionRecord } from './authorization-store';
import type { StandingAuthorizationTerms } from '@/types/recurring';

export type AuthorizationPhase =
  | 'scheduled'
  | 'due'
  | 'confirmed_this_period'
  | 'cap_reached'
  | 'paused'
  | 'cancelled'
  | 'completed';

export interface DueReminder {
  authorizationId: string;
  cycleNumber: number;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  corridorId: string;
  sourceAsset: string;
  destinationAsset: string;
  amount: string;
  remainingCap: string;
  anchorAllowlist: string[];
  termsHash: string;
}

export interface AuthorizationState {
  phase: AuthorizationPhase;
  due: DueReminder | null;
  nextDueAt: string | null;
  missedPeriods: number;
}

function calculateMissedPeriods(
  terms: StandingAuthorizationTerms,
  confirmed: StandingExecutionRecord[],
  now: Date
): number {
  const startAt = new Date(terms.startAt);
  const stopAt = new Date(terms.stopAt);

  if (now.getTime() < startAt.getTime()) {
    return 0;
  }

  const confirmedIndices = new Set(confirmed.map((e) => e.periodIndex));

  let maxIndex: number;
  if (now.getTime() >= stopAt.getTime()) {
    const lastWindow = periodWindow(terms, new Date(stopAt.getTime() - 1));
    if (!lastWindow) return 0;
    maxIndex = lastWindow.index + 1;
  } else {
    const w = periodWindow(terms, now);
    if (!w) return 0;
    maxIndex = w.index;
  }

  let missed = 0;
  for (let i = 0; i < maxIndex; i++) {
    if (!confirmedIndices.has(i)) {
      missed++;
    }
  }
  return missed;
}

export function computeAuthorizationState(
  record: StandingAuthorizationRecord,
  executions: StandingExecutionRecord[],
  now: Date
): AuthorizationState {
  const terms = record.authorization.terms;
  const confirmed = executions.filter((e) => e.status === 'confirmed');
  const missedPeriods = calculateMissedPeriods(terms, confirmed, now);

  if (record.status === 'cancelled') {
    return {
      phase: 'cancelled',
      due: null,
      nextDueAt: null,
      missedPeriods,
    };
  }

  if (record.status === 'paused') {
    return {
      phase: 'paused',
      due: null,
      nextDueAt: null,
      missedPeriods,
    };
  }

  const startAt = new Date(terms.startAt);
  const stopAt = new Date(terms.stopAt);

  if (now.getTime() >= stopAt.getTime()) {
    return {
      phase: 'completed',
      due: null,
      nextDueAt: null,
      missedPeriods,
    };
  }

  if (now.getTime() < startAt.getTime()) {
    return {
      phase: 'scheduled',
      due: null,
      nextDueAt: terms.startAt,
      missedPeriods: 0,
    };
  }

  const w = periodWindow(terms, now);
  if (!w) {
    return {
      phase: 'completed',
      due: null,
      nextDueAt: null,
      missedPeriods,
    };
  }

  const cycleNumber = w.index + 1;
  const confirmedThisPeriod = confirmed.some((e) => e.periodIndex === w.index);

  if (confirmedThisPeriod) {
    const nextDue = w.end.getTime() >= stopAt.getTime() ? null : w.end.toISOString();
    return {
      phase: 'confirmed_this_period',
      due: null,
      nextDueAt: nextDue,
      missedPeriods,
    };
  }

  const priors = confirmed.map((e) => ({ amount: e.amount, at: e.createdAt }));
  const remainingCap = remainingCapForPeriod(terms, priors, now);

  if (remainingCap === '0') {
    const nextDue = w.end.getTime() >= stopAt.getTime() ? null : w.end.toISOString();
    return {
      phase: 'cap_reached',
      due: null,
      nextDueAt: nextDue,
      missedPeriods,
    };
  }

  const termsAmountBig = parseDecimal(terms.amount);
  const remCapBig = parseDecimal(remainingCap);
  const dueAmount = termsAmountBig < remCapBig ? terms.amount : remainingCap;

  const due: DueReminder = {
    authorizationId: record.id,
    cycleNumber,
    periodIndex: w.index,
    periodStart: w.start.toISOString(),
    periodEnd: w.end.toISOString(),
    corridorId: terms.corridorId,
    sourceAsset: terms.sourceAsset,
    destinationAsset: terms.destinationAsset,
    amount: dueAmount,
    remainingCap,
    anchorAllowlist: terms.anchorAllowlist,
    termsHash: record.termsHash,
  };

  return {
    phase: 'due',
    due,
    nextDueAt: w.start.toISOString(),
    missedPeriods,
  };
}
