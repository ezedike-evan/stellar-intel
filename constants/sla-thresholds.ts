export interface SlaThresholds {
  p95Ms: number;
  p99Ms: number;
}

/** p95 matches DEFAULT_SLA_UNDERWRITING.maxP95SettlementMs in lib/reputation/sla.ts. */
export const DEFAULT_SLA_THRESHOLDS: Readonly<SlaThresholds> = {
  p95Ms: 15 * 60 * 1000,
  p99Ms: 60 * 60 * 1000,
};

/** Per-anchor overrides, keyed by anchor id from constants/anchors.ts. Maintainer-tuned; ships empty. */
export const ANCHOR_SLA_THRESHOLDS: Readonly<Record<string, Partial<SlaThresholds>>> = {};

export function getSlaThresholds(anchorId: string): SlaThresholds {
  return {
    ...DEFAULT_SLA_THRESHOLDS,
    ...ANCHOR_SLA_THRESHOLDS[anchorId],
  };
}
