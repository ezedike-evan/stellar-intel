// ─── Reference FX rates (USD → fiat) ─────────────────────────────────────────
//
// Free, key-less reference rates from open.er-api.com. Used only for *indicative*
// off-ramp estimates: the firm rate a user receives is always confirmed by the
// anchor at execution time. USDC is treated as 1:1 with USD for this estimate.

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(FX_ENDPOINT, { signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`FX rate request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
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
