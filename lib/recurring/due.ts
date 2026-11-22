import {
  type StoredStandingAuthorization,
  type StandingAuthorizationPeriod,
} from '@/types/recurring';
import { remainingCapForPeriod, periodWindow } from './enforce';
import { parseDecimal } from './scheduler';

export type DuePhase =
  | 'scheduled'
  | 'due'
  | 'confirmed_this_period'
  | 'cap_reached'
  | 'paused'
  | 'cancelled'
  | 'completed';

export interface DueReminder {
  authorizationId: string;
  sender: string;
  corridorId: string;
  sourceAsset: string;
  destinationAsset: string;
  amount: string;
  remainingCap: string;
  period: StandingAuthorizationPeriod;
  phase: DuePhase;
  due: boolean;
  nextDueAt: string;
  missedPeriods: number;
}

export function computeAuthorizationState(
  auth: StoredStandingAuthorization,
  nowMs: number = Date.now()
): DueReminder {
  const { terms, status, executions } = auth;
  const startEpoch = new Date(terms.startDate).getTime();

  if (status === 'paused') {
    return {
      authorizationId: auth.termsHash,
      sender: terms.sender,
      corridorId: terms.corridorId,
      sourceAsset: terms.sourceAsset,
      destinationAsset: terms.destinationAsset,
      amount: terms.amount,
      remainingCap: '0',
      period: terms.period,
      phase: 'paused',
      due: false,
      nextDueAt: '',
      missedPeriods: 0,
    };
  }

  if (status === 'cancelled') {
    return {
      authorizationId: auth.termsHash,
      sender: terms.sender,
      corridorId: terms.corridorId,
      sourceAsset: terms.sourceAsset,
      destinationAsset: terms.destinationAsset,
      amount: terms.amount,
      remainingCap: '0',
      period: terms.period,
      phase: 'cancelled',
      due: false,
      nextDueAt: '',
      missedPeriods: 0,
    };
  }

  if (terms.stopDate && nowMs > new Date(terms.stopDate).getTime()) {
    return {
      authorizationId: auth.termsHash,
      sender: terms.sender,
      corridorId: terms.corridorId,
      sourceAsset: terms.sourceAsset,
      destinationAsset: terms.destinationAsset,
      amount: terms.amount,
      remainingCap: '0',
      period: terms.period,
      phase: 'completed',
      due: false,
      nextDueAt: '',
      missedPeriods: 0,
    };
  }

  if (nowMs < startEpoch) {
    const { remainingCap } = remainingCapForPeriod(terms, executions, startEpoch);
    return {
      authorizationId: auth.termsHash,
      sender: terms.sender,
      corridorId: terms.corridorId,
      sourceAsset: terms.sourceAsset,
      destinationAsset: terms.destinationAsset,
      amount: terms.amount,
      remainingCap,
      period: terms.period,
      phase: 'scheduled',
      due: false,
      nextDueAt: terms.startDate,
      missedPeriods: 0,
    };
  }

  const window = periodWindow(terms.period, nowMs, terms.startDate);
  const { remainingCap } = remainingCapForPeriod(terms, executions, nowMs);

  const confirmedThisWindow = executions.filter((ex) => {
    if (ex.status !== 'confirmed') return false;
    const t = new Date(ex.executedAt).getTime();
    return t >= window.startMs && t < window.endMs;
  });

  const nextDueAt = new Date(window.endMs).toISOString();

  const reqScaled = parseDecimal(terms.amount);
  const remScaled = parseDecimal(remainingCap);
  if (remScaled < reqScaled) {
    return {
      authorizationId: auth.termsHash,
      sender: terms.sender,
      corridorId: terms.corridorId,
      sourceAsset: terms.sourceAsset,
      destinationAsset: terms.destinationAsset,
      amount: terms.amount,
      remainingCap,
      period: terms.period,
      phase: 'cap_reached',
      due: false,
      nextDueAt,
      missedPeriods: 0,
    };
  }

  if (confirmedThisWindow.length > 0) {
    return {
      authorizationId: auth.termsHash,
      sender: terms.sender,
      corridorId: terms.corridorId,
      sourceAsset: terms.sourceAsset,
      destinationAsset: terms.destinationAsset,
      amount: terms.amount,
      remainingCap,
      period: terms.period,
      phase: 'confirmed_this_period',
      due: false,
      nextDueAt,
      missedPeriods: 0,
    };
  }

  let stepMs = 24 * 60 * 60 * 1000;
  if (terms.period === 'weekly') stepMs = 7 * 24 * 60 * 60 * 1000;
  const cycleIndex = terms.period === 'monthly' ? 0 : Math.floor((nowMs - startEpoch) / stepMs);
  const missedPeriods = cycleIndex > 0 ? cycleIndex : 0;

  return {
    authorizationId: auth.termsHash,
    sender: terms.sender,
    corridorId: terms.corridorId,
    sourceAsset: terms.sourceAsset,
    destinationAsset: terms.destinationAsset,
    amount: terms.amount,
    remainingCap,
    period: terms.period,
    phase: 'due',
    due: true,
    nextDueAt,
    missedPeriods,
  };
}
