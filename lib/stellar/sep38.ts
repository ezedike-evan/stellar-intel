import type {
  Sep38Asset,
  Sep38DeliveryMethod,
  Sep38IndicativePrice,
  Sep38Info,
  Sep38PricesParams,
} from '@/types';

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when a SEP-38 response cannot be parsed into the expected schema. */
export class Sep38ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sep38ParseError';
  }
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const REQUEST_TIMEOUT_MS = 10_000;

interface CacheEntry {
  data: Sep38Info;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalizes a quote server URL into a stable cache key and base for requests. */
function normalizeQuoteServer(quoteServer: string): string {
  const trimmed = quoteServer.trim();
  if (!trimmed) {
    throw new Error('Quote server URL is required');
  }
  return trimmed.replace(/\/+$/, '');
}

function parseDeliveryMethods(value: unknown): Sep38DeliveryMethod[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((method) => {
    if (!isRecord(method) || typeof method['name'] !== 'string') {
      return [];
    }

    return [
      {
        name: method['name'],
        description: typeof method['description'] === 'string' ? method['description'] : '',
      },
    ];
  });
}

function parseCountryCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((code): code is string => typeof code === 'string');
}

function parseAssets(value: unknown): Sep38Asset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry['asset'] !== 'string') {
      return [];
    }

    return [
      {
        asset: entry['asset'],
        sellDeliveryMethods: parseDeliveryMethods(entry['sell_delivery_methods']),
        buyDeliveryMethods: parseDeliveryMethods(entry['buy_delivery_methods']),
        countryCodes: parseCountryCodes(entry['country_codes']),
      },
    ];
  });
}

// ─── Discovery endpoint ─────────────────────────────────────────────────────────

/**
 * Fetches the SEP-38 GET /info discovery response from an anchor's quote server,
 * returning the typed list of supported assets and their delivery methods.
 *
 * Results are cached in memory for 10 minutes per quote server. Failed requests
 * are not cached.
 */
export async function getSep38Info(quoteServer: string): Promise<Sep38Info> {
  const base = normalizeQuoteServer(quoteServer);

  const cached = cache.get(base);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${base}/info`, { signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`SEP-38 /info request to ${base} timed out after 10 seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${base} SEP-38 /info endpoint`);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  const data: Sep38Info = { assets: parseAssets(raw['assets']) };

  cache.set(base, { data, expiresAt: Date.now() + TTL_MS });
  return data;
}

function parsePrices(raw: Record<string, unknown>): Sep38IndicativePrice[] {
  const buyAssets = raw['buy_assets'];
  if (!Array.isArray(buyAssets)) {
    throw new Sep38ParseError('SEP-38 /prices response is missing a "buy_assets" array');
  }

  return buyAssets.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Sep38ParseError(`SEP-38 /prices buy_assets[${index}] is not an object`);
    }

    const asset = entry['asset'];
    if (typeof asset !== 'string' || asset.length === 0) {
      throw new Sep38ParseError(`SEP-38 /prices buy_assets[${index}] is missing a string "asset"`);
    }

    const price = entry['price'];
    if (typeof price !== 'string' || price.length === 0) {
      throw new Sep38ParseError(`SEP-38 /prices buy_assets[${index}] is missing a string "price"`);
    }

    // GET /prices returns a single indicative price per buy asset; total_price
    // mirrors it unless the anchor provides a distinct value.
    const totalPrice = typeof entry['total_price'] === 'string' ? entry['total_price'] : price;

    // buy_asset is a named alias for asset — both are required by the issue spec
    // so callers can use the semantically clearer field name.
    return { asset, buy_asset: asset, price, total_price: totalPrice };
  });
}

// ─── Indicative prices endpoint ─────────────────────────────────────────────────

/**
 * Fetches indicative (non-firm) prices from an anchor's SEP-38 GET /prices
 * endpoint for a given sell asset and amount — used when a user browses without
 * committing to a firm quote.
 *
 * Indicative prices change frequently and are intentionally NOT cached. A
 * malformed response (missing buy_assets, or an entry lacking a string
 * asset/price) throws a {@link Sep38ParseError}.
 */
export async function getSep38Prices(
  quoteServer: string,
  params: Sep38PricesParams
): Promise<Sep38IndicativePrice[]> {
  const base = normalizeQuoteServer(quoteServer);

  if (!params.sell_asset || !params.sell_amount) {
    throw new Sep38ParseError('sell_asset and sell_amount are required');
  }

  const url = new URL(`${base}/prices`);
  url.searchParams.set('sell_asset', params.sell_asset);
  url.searchParams.set('sell_amount', params.sell_amount);
  if (params.sell_delivery_method) {
    url.searchParams.set('sell_delivery_method', params.sell_delivery_method);
  }
  if (params.buy_delivery_method) {
    url.searchParams.set('buy_delivery_method', params.buy_delivery_method);
  }
  if (params.country_code) {
    url.searchParams.set('country_code', params.country_code);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`SEP-38 /prices request to ${base} timed out after 10 seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${base} SEP-38 /prices endpoint`);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  return parsePrices(raw);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exposed for testing only — clears the in-memory SEP-38 /info cache. */
export function _clearSep38Cache(): void {
  cache.clear();
}
