/**
 * lib/reputation/sla.ts
 *
 * Settlement SLA underwriting — Primitive III (issue #814).
 *
 * A $100-capped settlement guarantee: a covered off-ramp is promised to settle
 * within a guaranteed deadline, and if it breaches, the user is eligible for a
 * payout up to the cap. This module is the **underwriting layer** — it decides
 * whether a corridor/anchor pair may be offered an SLA (from the actuarial
 * dataset) and whether a given terminal outcome triggers a payout.
 *
 * Fail-closed by construction: eligibility is granted only when the actuarial
 * aggregate clears every threshold, so a pair with thin or poor data is never
 * covered. Nothing here executes a payout or moves funds; it produces the
 * decision that a wired, maintainer-activated flow consumes once the actuarial
 * dataset has reached threshold (the hard block on this issue). Guarantee terms
 * and the dispute process are documented in `docs/SETTLEMENT_SLA.md` and reuse
 * the existing reputation dispute surface (`POST /api/reputation/dispute`).
 */

import type { CorridorAggregate } from './aggregate';
import type { OutcomeStatus } from '@/types/reputation';

/** The only cap shipped in this launch. Do not raise as part of #814. */
export const SLA_CAP_USD = 100;

/** Thresholds a corridor/anchor pair must clear to be offered an SLA. */
export interface SlaUnderwritingConfig {
  /** Minimum settled-outcome sample size before a pair can be underwritten. */
  minTxCount: number;
  /** Minimum success (fill) rate, successCount / txCount, in [0, 1]. */
  minSuccessRate: number;
  /** p95 settlement latency must be at or below this (ms). */
  maxP95SettlementMs: number;
  /** Minimum composite reputation score (see lib/reputation/composite.ts). */
  minCompositeScore: number;
  /** Actuarial window the eligibility must be evaluated over. */
  requiredWindowDays: 7 | 30 | 90;
  /** Guaranteed deadline = p95 × this margin (headroom over observed latency). */
  settlementMarginFactor: number;
}

/**
 * Conservative defaults for the initial launch: a full 90-day window, a large
 * sample, a near-perfect fill rate, tight latency, and a strong composite. Real
 * values are the maintainer's to tune once the actuarial dataset exists.
 */
export const DEFAULT_SLA_UNDERWRITING: SlaUnderwritingConfig = {
  minTxCount: 100,
  minSuccessRate: 0.98,
  maxP95SettlementMs: 15 * 60 * 1000, // 15 minutes
  minCompositeScore: 0.9,
  requiredWindowDays: 90,
  settlementMarginFactor: 1.5,
};

export type SlaEligibility =
  | {
      eligible: true;
      capUsd: number;
      /** The deadline the SLA guarantees for a covered settlement (ms). */
      guaranteedSettlementMs: number;
      windowDays: 7 | 30 | 90;
      sampleSize: number;
    }
  | { eligible: false; reasons: string[] };

/**
 * Decides whether a corridor/anchor pair may be offered a settlement SLA, from
 * its actuarial aggregate. Fail-closed: any unmet threshold (including missing
 * latency/composite data) makes the pair ineligible with explicit reasons.
 */
export function assessSlaEligibility(
  aggregate: CorridorAggregate,
  config: SlaUnderwritingConfig = DEFAULT_SLA_UNDERWRITING
): SlaEligibility {
  const reasons: string[] = [];

  if (aggregate.windowDays !== config.requiredWindowDays) {
    reasons.push(
      `requires a ${config.requiredWindowDays}-day window (got ${aggregate.windowDays})`
    );
  }
  if (aggregate.txCount < config.minTxCount) {
    reasons.push(`insufficient sample: ${aggregate.txCount} < ${config.minTxCount}`);
  }

  const successRate = aggregate.txCount > 0 ? aggregate.successCount / aggregate.txCount : 0;
  if (successRate < config.minSuccessRate) {
    reasons.push(
      `fill rate ${(successRate * 100).toFixed(1)}% < ${(config.minSuccessRate * 100).toFixed(1)}%`
    );
  }

  if (aggregate.p95SettlementMs === null || aggregate.p95SettlementMs > config.maxP95SettlementMs) {
    reasons.push(
      `p95 settlement ${aggregate.p95SettlementMs ?? 'n/a'}ms exceeds ${config.maxP95SettlementMs}ms`
    );
  }

  if (aggregate.compositeScore === null || aggregate.compositeScore < config.minCompositeScore) {
    reasons.push(`composite ${aggregate.compositeScore ?? 'n/a'} < ${config.minCompositeScore}`);
  }

  if (reasons.length > 0) {
    return { eligible: false, reasons };
  }

  const guaranteedSettlementMs = Math.round(
    (aggregate.p95SettlementMs as number) * config.settlementMarginFactor
  );

  return {
    eligible: true,
    capUsd: SLA_CAP_USD,
    guaranteedSettlementMs,
    windowDays: aggregate.windowDays,
    sampleSize: aggregate.txCount,
  };
}

/** An order is coverable only when it is positive and within the $100 cap. */
export function isAmountCovered(amountUsd: number): boolean {
  return Number.isFinite(amountUsd) && amountUsd > 0 && amountUsd <= SLA_CAP_USD;
}

/** A settled/terminal covered intent, evaluated for an SLA payout. */
export interface SlaClaim {
  amountUsd: number;
  outcome: OutcomeStatus;
  /** Observed settlement time in seconds; null when the anchor never settled. */
  settleSeconds: number | null;
  /** The deadline this intent was underwritten against (from eligibility). */
  guaranteedSettlementMs: number;
}

export type PayoutAssessment =
  | { payable: true; amountUsd: number; reason: 'breach_outcome' | 'latency_breach' }
  | { payable: false; reason: string };

/** Terminal outcomes that fail the settlement guarantee outright. */
const BREACH_OUTCOMES: readonly OutcomeStatus[] = ['refunded', 'expired', 'error', 'partial'];

/**
 * Decides whether a covered intent's terminal outcome triggers an SLA payout.
 * Payout is due when the settlement failed (breach outcome) or completed past
 * the guaranteed deadline (latency breach); it is always capped at $100. A
 * clean, on-time settlement is not payable.
 */
export function assessPayout(claim: SlaClaim): PayoutAssessment {
  if (!isAmountCovered(claim.amountUsd)) {
    return {
      payable: false,
      reason: `amount ${claim.amountUsd} is outside the $${SLA_CAP_USD} cap`,
    };
  }

  if (BREACH_OUTCOMES.includes(claim.outcome)) {
    return {
      payable: true,
      amountUsd: Math.min(claim.amountUsd, SLA_CAP_USD),
      reason: 'breach_outcome',
    };
  }

  if (
    claim.outcome === 'completed' &&
    claim.settleSeconds !== null &&
    claim.settleSeconds * 1000 > claim.guaranteedSettlementMs
  ) {
    return {
      payable: true,
      amountUsd: Math.min(claim.amountUsd, SLA_CAP_USD),
      reason: 'latency_breach',
    };
  }

  return { payable: false, reason: 'settled within the guaranteed deadline' };
}
