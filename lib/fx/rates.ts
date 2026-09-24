// ─── Reference FX rates (USD → fiat) ─────────────────────────────────────────
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
 * Returns the live reference exchange rate from `from` currency to `to` currency
 * (ISO 4217, e.g. "EUR" → "NGN", "ARS" → "ARS").
 *
 * - Identity case: When `from` and `to` are the same currency (case-insensitive),
 *   returns `1` immediately without making any network request.
 * - Direct USD case: When `from` is "USD", delegates directly to `getUsdFxRate(to)`.
 * - Cross-rate case: When converting between non-USD currencies, calculates the
 *   cross-rate via USD (`rate(USD→to) / rate(USD→from)`) using the same cached
 *   USD rate table.
 *
 * Throws when a reference rate is unavailable for either leg of the pair.
 */
export async function getFxRate(from: string, to: string): Promise<number> {
  const upperFrom = from.toUpperCase();
  const upperTo = to.toUpperCase();

  if (upperFrom === upperTo) {
    return 1;
  }

  if (upperFrom === 'USD') {
    return getUsdFxRate(upperTo);
  }

  const rates = await loadRates();
  const fromRate = rates[upperFrom];
  const toRate = upperTo === 'USD' ? 1 : rates[upperTo];

  if (
    typeof fromRate !== 'number' ||
    !Number.isFinite(fromRate) ||
    fromRate <= 0 ||
    typeof toRate !== 'number' ||
    !Number.isFinite(toRate) ||
    toRate <= 0
  ) {
    throw new Error(`No reference FX rate available for ${upperFrom}→${upperTo}`);
  }

  return toRate / fromRate;
}
