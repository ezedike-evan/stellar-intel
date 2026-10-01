// ─── Reference FX rates (USD → fiat & Cross-currency) ───────────────────────
//
// Free, key-less reference rates from open.er-api.com. Used only for *indicative*
// off-ramp estimates: the firm rate a user receives is always confirmed by the
// anchor at execution time. USDC is treated as 1:1 with USD for this estimate.

import { fetchWithTimeout } from '@/lib/stellar/http';

interface FxCacheEntry {
  rates: Record<string, number>;
  expiresAt: number;
}

const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const TTL_MS = 10 * 60 * 1000; // reference rates move slowly; 10 min is plenty
const REQUEST_TIMEOUT_MS = 6_000;

let cache: FxCacheEntry | null = null;

/** Clears the in-memory FX cache. Exposed for tests only. */
export function _clearFxCache(): void {
  cache = null;
}

async function loadRates(): Promise<Record<string, number>> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.rates;
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(FX_ENDPOINT, REQUEST_TIMEOUT_MS);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`FX rate request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  if (!res.ok) {
    throw new Error(`FX rate provider returned HTTP ${res.status}`);
  }

  const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (body.result !== 'success' || !body.rates) {
    throw new Error('FX rate provider returned an unexpected payload');
  }

  cache = { rates: body.rates, expiresAt: Date.now() + TTL_MS };
  return body.rates;
}

/**
 * Returns the live reference rate for 1 USD in `currencyCode` (ISO 4217, e.g.
 * "NGN"). Throws when the currency is not quoted by the provider.
 */
export async function getUsdFxRate(currencyCode: string): Promise<number> {
  const rates = await loadRates();
  const rate = rates[currencyCode.toUpperCase()];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No reference FX rate available for USD→${currencyCode}`);
  }
  return rate;
}

/**
 * Returns the reference FX rate from `from` currency to `to` currency.
 *
 * - **Identity case**: When `from === to` (case-insensitive), returns `1` immediately
 *   without performing any network call or reading the cache.
 * - **USD base**: When `from === 'USD'`, returns the USD reference rate for `to`.
 * - **Cross rate**: For non-USD pairs (e.g. EUR → NGN), calculates the cross rate via USD
 *   as `(USD→to) / (USD→from)` using the same cached reference table.
 *
 * @throws {Error} When either leg is not quoted by the reference provider ("No reference FX rate available for FROM→TO").
 */
export async function getFxRate(from: string, to: string): Promise<number> {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  if (fromUpper === toUpper) {
    return 1;
  }

  const rates = await loadRates();
  const fromRate = fromUpper === 'USD' ? 1 : rates[fromUpper];
  const toRate = toUpper === 'USD' ? 1 : rates[toUpper];

  if (
    typeof fromRate !== 'number' ||
    !Number.isFinite(fromRate) ||
    fromRate <= 0 ||
    typeof toRate !== 'number' ||
    !Number.isFinite(toRate) ||
    toRate <= 0
  ) {
    throw new Error(`No reference FX rate available for ${fromUpper}→${toUpper}`);
  }

  return toRate / fromRate;
}
