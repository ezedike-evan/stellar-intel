import type { OutcomeLogRow, SlippageBreach } from '@/types/reputation';

export type SlippageComplianceWindow = 30 | 90 | 'all';

export interface SlippageComplianceGate {
  targetPct: number;
  minIntents: number;
  met: boolean;
}

export interface SlippageCompliance {
  window: SlippageComplianceWindow;
  eligibleIntents: number;
  breaches: number;
  verifiedBreaches: number;
  compliancePct: number | null;
  gate: SlippageComplianceGate;
}

export interface ComputeSlippageComplianceOptions {
  window: SlippageComplianceWindow;
  now?: number;
}

const TARGET_COMPLIANCE_PCT = 99.0;
const MIN_ELIGIBLE_INTENTS = 100;

/**
 * Computes the slippage compliance metrics and v3 release gate status over a
 * rolling window of withdraw intents and detected slippage breaches.
 *
 * Rules:
 * - Only withdraw intents (direction === 'withdraw') are eligible.
 * - Rows and breaches are filtered to the evaluation window (30/90 days or all).
 * - Only 'verified' breaches reduce the compliance score.
 * - If eligibleIntents === 0: compliancePct is null and gate.met is false.
 * - Otherwise: compliancePct = Math.round(((eligibleIntents - verifiedBreaches) / eligibleIntents) * 10000) / 100
 * - Release gate: met = eligibleIntents >= 100 && compliancePct >= 99.0
 */
export function computeSlippageCompliance(
  rows: OutcomeLogRow[],
  breaches: SlippageBreach[],
  opts: ComputeSlippageComplianceOptions
): SlippageCompliance {
  const now = opts.now ?? Date.now();
  const window = opts.window;
  const cutoff = window === 'all' ? 0 : now - window * 24 * 60 * 60 * 1000;

  const eligibleRows = rows.filter((r) => {
    if (r.direction !== 'withdraw') return false;
    if (window === 'all') return true;
    const createdAtMs = new Date(r.createdAt).getTime();
    return !Number.isNaN(createdAtMs) && createdAtMs >= cutoff;
  });

  const windowBreaches = breaches.filter((b) => {
    if (window === 'all') return true;
    const detectedAtMs = new Date(b.detectedAt).getTime();
    return !Number.isNaN(detectedAtMs) && detectedAtMs >= cutoff;
  });

  const eligibleIntents = eligibleRows.length;
  const breachesCount = windowBreaches.length;
  const verifiedBreaches = windowBreaches.filter((b) => b.status === 'verified').length;

  if (eligibleIntents === 0) {
    return {
      window,
      eligibleIntents: 0,
      breaches: breachesCount,
      verifiedBreaches,
      compliancePct: null,
      gate: {
        targetPct: TARGET_COMPLIANCE_PCT,
        minIntents: MIN_ELIGIBLE_INTENTS,
        met: false,
      },
    };
  }

  const rawRatio = ((eligibleIntents - verifiedBreaches) / eligibleIntents) * 10000;
  const compliancePct = Math.max(0, Math.round(rawRatio) / 100);
  const met = eligibleIntents >= MIN_ELIGIBLE_INTENTS && compliancePct >= TARGET_COMPLIANCE_PCT;

  return {
    window,
    eligibleIntents,
    breaches: breachesCount,
    verifiedBreaches,
    compliancePct,
    gate: {
      targetPct: TARGET_COMPLIANCE_PCT,
      minIntents: MIN_ELIGIBLE_INTENTS,
      met,
    },
  };
}
