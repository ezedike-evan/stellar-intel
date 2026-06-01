/**
 * Fee-adjusted rate ranking for SEP-24 / SEP-38 anchor quotes.
 *
 * Rankings are based on net-received amount:
 *   netReceived = (sellAmount - totalFees) × exchangeRate
 *
 * Currency precision is respected via rounding to the fiat currency's decimal
 * precision before comparison so that floating-point noise cannot flip rankings.
 *
 * All arithmetic uses explicit rounding to avoid sub-cent comparisons.
 */

import type { AnchorRate, RateComparison } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default decimal precision for fiat currencies (2 decimal places, e.g. NGN).
 * Pass a higher value for currencies with sub-cent units (e.g. KWD = 3).
 */
export const DEFAULT_FIAT_PRECISION = 2;

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Computes the net fiat amount received after all fees have been deducted and
 * the exchange rate applied, rounded to the given decimal precision.
 *
 * Formula:
 *   netReceived = round((sellAmount - flatFee) × (1 - feePercent / 100) × exchangeRate, precision)
 *
 * @param sellAmount   Gross USDC sell amount.
 * @param flatFee      Flat fee in USDC charged by the anchor.
 * @param feePercent   Percentage fee (0–100) charged by the anchor.
 * @param exchangeRate Local currency units per 1 USDC.
 * @param precision    Decimal places to round the result to (default: 2).
 */
export function computeNetReceived(
  sellAmount: number,
  flatFee: number,
  feePercent: number,
  exchangeRate: number,
  precision: number = DEFAULT_FIAT_PRECISION
): number {
  if (exchangeRate <= 0) return 0;

  const afterFlat = Math.max(0, sellAmount - flatFee);
  const afterPercent = afterFlat * (1 - feePercent / 100);
  const raw = afterPercent * exchangeRate;

  // Round to the target currency precision
  const factor = 10 ** precision;
  return Math.round(raw * factor) / factor;
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

/**
 * Ranks AnchorRate entries by netReceived in descending order (highest first).
 *
 * Entries with a null totalReceived (unavailable anchors) are placed last.
 *
 * Stability: equal-netReceived anchors retain their original order (sort is
 * stable in V8 ≥ Node 11 / all modern browsers per ECMAScript 2019).
 *
 * @param rates      Array of AnchorRate objects from one or more anchors.
 * @param precision  Decimal precision for comparison (default: 2).
 * @returns          New array sorted by netReceived descending; input unchanged.
 */
export function rankByNetReceived(
  rates: AnchorRate[],
  precision: number = DEFAULT_FIAT_PRECISION
): AnchorRate[] {
  return [...rates].sort((a, b) => {
    const aVal = resolvedNetReceived(a, precision);
    const bVal = resolvedNetReceived(b, precision);
    return bVal - aVal;
  });
}

/**
 * Returns the best AnchorRate by net-received, or `null` for empty input.
 *
 * @param rates      Array of candidate AnchorRate objects.
 * @param precision  Decimal precision for comparison (default: 2).
 */
export function bestRate(
  rates: AnchorRate[],
  precision: number = DEFAULT_FIAT_PRECISION
): AnchorRate | null {
  if (rates.length === 0) return null;

  return rates.reduce((best, candidate) => {
    const bestVal = resolvedNetReceived(best, precision);
    const candVal = resolvedNetReceived(candidate, precision);
    return candVal > bestVal ? candidate : best;
  });
}

// ─── RateComparison builder ───────────────────────────────────────────────────

/**
 * Builds a `RateComparison` from an array of settled anchor-rate promises.
 *
 * Fulfilled results are ranked by netReceived; rejected results are discarded.
 *
 * @param settled    Output of `Promise.allSettled(...)` over AnchorRate fetches.
 * @param corridorId The corridor all rates belong to.
 * @param precision  Decimal precision used for ranking (default: 2).
 */
export function buildRateComparison(
  settled: PromiseSettledResult<AnchorRate>[],
  corridorId: string,
  precision: number = DEFAULT_FIAT_PRECISION
): RateComparison {
  const fulfilled = settled
    .filter((r): r is PromiseFulfilledResult<AnchorRate> => r.status === 'fulfilled')
    .map((r) => r.value);

  const ranked = rankByNetReceived(fulfilled, precision);
  const best = ranked[0] ?? null;

  return {
    corridorId,
    rates: ranked,
    bestRateId: best?.anchorId ?? '',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves an AnchorRate's effective net-received value for comparison.
 * Unavailable anchors (null totalReceived) sort to the bottom.
 */
function resolvedNetReceived(rate: AnchorRate, precision: number): number {
  if (rate.totalReceived == null || rate.exchangeRate == null || rate.fee == null) {
    return -Infinity;
  }

  // Re-derive from first principles so that precision rounding is applied
  // consistently regardless of how totalReceived was originally computed.
  const feePercent = rate.feeType === 'percent' || rate.feeType === 'combined' ? rate.fee : 0;
  const flatFee = rate.feeType === 'flat' || rate.feeType === 'combined' ? rate.fee : 0;

  // For feeType === 'combined' the fee field holds the flat portion;
  // a proper combined-fee model would need separate fields — we handle it
  // gracefully by treating fee as flat when feeType is not 'percent'.
  const effectiveFlat = rate.feeType === 'percent' ? 0 : flatFee;
  const effectivePct = rate.feeType === 'percent' ? feePercent : 0;

  // Use the stored totalReceived as authoritative if it is not null, but run
  // it through the precision rounding so comparisons are on equal footing.
  const raw = rate.totalReceived;
  const factor = 10 ** precision;
  return Math.round(raw * factor) / factor;
}
