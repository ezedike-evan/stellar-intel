import type { DepositRate } from '@/types';

// Kept apart from deposit-rates.ts, which reaches the network and the reputation
// store: a client component that imports a helper from there pulls `pg` into the
// browser bundle. deposit-rates re-exports these for server callers.

export type DepositLimitStatus = 'ok' | 'below_min' | 'above_max';

/**
 * Whether the deposit sits inside the anchor's published SEP-24 limits. The
 * limits are in asset units, so they are checked against `assetAmount` (what the
 * fiat buys before fees), not the fiat figure: comparing NGN to USDC bounds
 * would block deposits the anchor accepts. A row with no limits, or with no
 * `assetAmount` to measure, is `ok`; the boundaries themselves are in range.
 */
export function depositLimitStatus(rate: DepositRate): DepositLimitStatus {
  const amount = rate.assetAmount;
  if (amount === undefined) return 'ok';
  if (rate.minAmount !== undefined && amount < rate.minAmount) return 'below_min';
  if (rate.maxAmount !== undefined && amount > rate.maxAmount) return 'above_max';
  return 'ok';
}
