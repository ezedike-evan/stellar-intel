import type { OutcomeLogRow, SlippageBreach } from '@/types/reputation';

/** The v3 gate: at least this share of eligible intents landed at or above their floor. */
export const SLIPPAGE_COMPLIANCE_TARGET_PCT = 99.5;

/** The gate is only met over at least this many eligible intents. */
export const SLIPPAGE_COMPLIANCE_MIN_INTENTS = 10_000;

/** A number of days back from now, or every row there is. */
export type SlippageComplianceWindow = 30 | 90 | 'all';

export interface SlippageCompliance {
  window: SlippageComplianceWindow;
  /** Attested, completed, undisputed withdrawals in the window that carry a floor and a delivered amount. */
  eligibleIntents: number;
  /** Eligible intents with a breach on record that was not rejected. */
  breaches: number;
  /** The part of `breaches` already verified against the Stellar payment. */
  verifiedBreaches: number;
  /** Share of eligible intents without a breach, in percent to two decimals; null when none is eligible. */
  compliancePct: number | null;
  gate: { targetPct: number; minIntents: number; met: boolean };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Slippage-bound compliance: of the intents that named a minimum to receive and
 * reported what was delivered, the share that has no breach on record.
 *
 * An intent is eligible when it can be judged at all: an attested, completed,
 * undisputed withdrawal with both a `minReceive` and a `deliveredAmount`, created
 * inside the window. Deposits are measured on another basis, and a row whose date
 * cannot be read is left out of every window, `'all'` included.
 *
 * A breach counts when it belongs to an eligible intent and has not been rejected,
 * so a breach that is still only `detected` already lowers the figure. It counts
 * once per intent, however many records name that intent.
 *
 * The gate asks for volume as well as the percentage: a perfect score over a
 * handful of intents does not meet it.
 */
export function computeSlippageCompliance(
  rows: readonly OutcomeLogRow[],
  breaches: readonly Pick<SlippageBreach, 'intentHash' | 'status'>[],
  opts: { window: SlippageComplianceWindow; now?: number }
): SlippageCompliance {
  const { window } = opts;
  const cutoff = window === 'all' ? null : (opts.now ?? Date.now()) - window * DAY_MS;

  const eligible = new Set<string>();
  for (const row of rows) {
    if (!row.attested || row.direction !== 'withdraw') continue;
    if (row.outcome !== 'completed' || row.disputed) continue;
    if (row.minReceive == null || row.deliveredAmount === null) continue;
    const created = Date.parse(row.createdAt);
    if (!Number.isFinite(created)) continue;
    if (cutoff !== null && created < cutoff) continue;
    eligible.add(row.intentHash);
  }

  const breached = new Set<string>();
  const verified = new Set<string>();
  for (const breach of breaches) {
    if (breach.status === 'rejected' || !eligible.has(breach.intentHash)) continue;
    breached.add(breach.intentHash);
    if (breach.status === 'verified') verified.add(breach.intentHash);
  }

  const eligibleIntents = eligible.size;
  const compliancePct =
    eligibleIntents === 0
      ? null
      : Math.round(((eligibleIntents - breached.size) / eligibleIntents) * 10_000) / 100;

  return {
    window,
    eligibleIntents,
    breaches: breached.size,
    verifiedBreaches: verified.size,
    compliancePct,
    gate: {
      targetPct: SLIPPAGE_COMPLIANCE_TARGET_PCT,
      minIntents: SLIPPAGE_COMPLIANCE_MIN_INTENTS,
      met:
        eligibleIntents >= SLIPPAGE_COMPLIANCE_MIN_INTENTS &&
        compliancePct !== null &&
        compliancePct >= SLIPPAGE_COMPLIANCE_TARGET_PCT,
    },
  };
}
