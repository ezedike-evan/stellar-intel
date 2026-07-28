import type { OutcomeLogRow } from '@/types/reputation';

/**
 * lib/oracle/corridor-rate.ts
 *
 * Off-chain feed for the corridor rate oracle (issue #810): derives a
 * block-level rate for each target corridor from live execution data — the
 * delivered rates of settled outcomes (#799) — scaled for the on-chain
 * `publish_corridor_rate` entrypoint. Probe data (#785) keeps the input fresh
 * upstream; the actuarial rate itself comes from real settlements.
 */

/** The corridors the rate oracle publishes on-chain. */
export const TARGET_CORRIDORS = ['usdc-ngn', 'usdc-kes', 'usdc-mxn', 'usdc-php'] as const;
export type TargetCorridor = (typeof TARGET_CORRIDORS)[number];

/** On-chain publish precision — rate scaled by 10^7 (Stellar's 7-dp convention). */
export const RATE_DECIMALS = 7;

export interface CorridorRatePublish {
  corridor: TargetCorridor;
  /** Rate scaled by 10^RATE_DECIMALS (fiat per 1 USDC); pass to publish_corridor_rate. */
  rate: bigint;
  decimals: number;
  /** How many settled outcomes the rate was derived from. */
  sampleCount: number;
}

/** Parse a positive decimal string into a BigInt scaled by 10^`decimals`. */
function toScaled(value: string, decimals: number): bigint {
  const [intPart = '0', fracRaw = ''] = value.trim().split('.');
  const frac = `${fracRaw}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(intPart || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2n : sorted[mid]!;
}

/**
 * Derives the corridor rate to publish from the median delivered rate of the
 * corridor's settled outcomes, or null when there's no settled data yet.
 */
export function deriveCorridorRate(
  corridor: TargetCorridor,
  outcomes: readonly OutcomeLogRow[]
): CorridorRatePublish | null {
  const rates = outcomes
    .filter((o) => o.corridor === corridor && o.deliveredRate !== null)
    .map((o) => toScaled(o.deliveredRate as string, RATE_DECIMALS))
    .filter((r) => r > 0n);

  if (rates.length === 0) return null;

  return {
    corridor,
    rate: median(rates),
    decimals: RATE_DECIMALS,
    sampleCount: rates.length,
  };
}

/** Derives publishable rates for every target corridor that has settled data. */
export function deriveAllCorridorRates(outcomes: readonly OutcomeLogRow[]): CorridorRatePublish[] {
  return TARGET_CORRIDORS.map((corridor) => deriveCorridorRate(corridor, outcomes)).filter(
    (r): r is CorridorRatePublish => r !== null
  );
}
