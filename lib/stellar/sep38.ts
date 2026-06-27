import { parseSepErrorBody } from './errors';
import type {
  Sep1TomlData,
  Sep38Asset,
  Sep38DeliveryMethod,
  Sep38IndicativePrice,
  Sep38Info,
  Sep38PricesParams,
  Sep38Quote,
  Sep38QuoteContext,
  Sep38QuoteParams,
} from '@/types';

/**
 * Asserts that an anchor advertises ANCHOR_QUOTE_SERVER in its stellar.toml.
 * Throws if the anchor is not SEP-38 capable; returns the quote server URL otherwise.
 */
export function assertSep38Capable(toml: Sep1TomlData): string {
  if (!toml.capabilities.sep38 || !toml.ANCHOR_QUOTE_SERVER) {
    throw new Error(
      `Anchor "${toml.domain}" does not advertise ANCHOR_QUOTE_SERVER and cannot be used for SEP-38.`
    );
  }
  return toml.ANCHOR_QUOTE_SERVER;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

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

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

// ─── getSep38Info helpers ─────────────────────────────────────────────────────

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

// ─── Discovery endpoint ───────────────────────────────────────────────────────

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

/** Exposed for testing only — clears the in-memory SEP-38 /info cache. */
export function _clearSep38Cache(): void {
  cache.clear();
}

// ─── getSep38Prices helpers ───────────────────────────────────────────────────

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

    const totalPrice = typeof entry['total_price'] === 'string' ? entry['total_price'] : price;

    // buy_asset is a named alias for asset — both are required by the issue spec
    // so callers can use the semantically clearer field name.
    return { asset, buy_asset: asset, price, total_price: totalPrice };
  });
}

// ─── Indicative prices endpoint ───────────────────────────────────────────────

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

// ─── getSep38Price helpers ────────────────────────────────────────────────────

const PRICE_PATH = '/price';

export interface Sep38PriceParams {
  quoteServer: string;
  sell_asset: string;
  buy_asset: string;
  sell_amount: string;
  buy_delivery_method?: string;
  context: string;
}

export interface Sep38FeeDetail {
  name: string;
  amount: string;
  description?: string;
}

export interface Sep38Fee {
  total: string;
  asset: string;
  details?: Sep38FeeDetail[];
}

export interface Sep38PriceResponse {
  price: string;
  sell_amount: string;
  buy_amount: string;
  total_price?: string;
  fee?: Sep38Fee;
}

function assertNonEmpty(value: string, fieldName: keyof Sep38PriceParams): void {
  if (value.trim().length === 0) {
    throw new Error(`SEP-38 /price requires a non-empty "${fieldName}"`);
  }
}

function getRequiredString(data: Record<string, unknown>, fieldName: string): string {
  const value = data[fieldName];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid SEP-38 /price response: missing "${fieldName}"`);
  }
  return value;
}

function parseFee(raw: unknown): Sep38Fee | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new Error('Invalid SEP-38 /price response: "fee" must be an object');
  }

  const fee: Sep38Fee = {
    total: getRequiredString(raw, 'total'),
    asset: getRequiredString(raw, 'asset'),
  };

  const details = raw['details'];
  if (details !== undefined) {
    if (!Array.isArray(details)) {
      throw new Error('Invalid SEP-38 /price response: "fee.details" must be an array');
    }

    fee.details = details.map((detail) => {
      if (!isRecord(detail)) {
        throw new Error('Invalid SEP-38 /price response: each fee detail must be an object');
      }

      const parsed: Sep38FeeDetail = {
        name: getRequiredString(detail, 'name'),
        amount: getRequiredString(detail, 'amount'),
      };

      if (typeof detail['description'] === 'string') {
        parsed.description = detail['description'];
      }

      return parsed;
    });
  }

  return fee;
}

function buildPriceUrl(params: Sep38PriceParams): string {
  assertNonEmpty(params.quoteServer, 'quoteServer');
  assertNonEmpty(params.sell_asset, 'sell_asset');
  assertNonEmpty(params.buy_asset, 'buy_asset');
  assertNonEmpty(params.sell_amount, 'sell_amount');
  assertNonEmpty(params.context, 'context');

  const quoteServer = params.quoteServer.replace(/\/+$/, '');
  const url = new URL(`${quoteServer}${PRICE_PATH}`);
  url.searchParams.set('sell_asset', params.sell_asset);
  url.searchParams.set('buy_asset', params.buy_asset);
  url.searchParams.set('sell_amount', params.sell_amount);
  url.searchParams.set('context', params.context);

  if (params.buy_delivery_method && params.buy_delivery_method.trim().length > 0) {
    url.searchParams.set('buy_delivery_method', params.buy_delivery_method);
  }

  return url.toString();
}

function parsePriceResponse(data: unknown): Sep38PriceResponse {
  if (!isRecord(data)) {
    throw new Error('Invalid SEP-38 /price response: expected an object');
  }

  const response: Sep38PriceResponse = {
    price: getRequiredString(data, 'price'),
    sell_amount: getRequiredString(data, 'sell_amount'),
    buy_amount: getRequiredString(data, 'buy_amount'),
  };

  if (typeof data['total_price'] === 'string') {
    response.total_price = data['total_price'];
  }

  const fee = parseFee(data['fee']);
  if (fee) response.fee = fee;

  return response;
}

/**
 * Fetches an indicative SEP-38 price for a specific asset pair.
 *
 * This wraps GET /price and intentionally supports the sell_amount path needed
 * by the off-ramp comparator. Firm quotes belong to POST /quote.
 */
export async function getSep38Price(params: Sep38PriceParams): Promise<Sep38PriceResponse> {
  const url = buildPriceUrl(params);
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw parseSepErrorBody(body, res.status);
  }

  return parsePriceResponse(await res.json());
}

// ─── getSep38Quote helpers ────────────────────────────────────────────────────

function requireString(raw: Record<string, unknown>, field: string, endpoint: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Sep38ParseError(`SEP-38 ${endpoint} response is missing a string "${field}"`);
  }
  return value;
}

function parseQuote(raw: Record<string, unknown>, context: Sep38QuoteContext): Sep38Quote {
  const id = requireString(raw, 'id', '/quote');
  const expiresAt = requireString(raw, 'expires_at', '/quote');
  const price = requireString(raw, 'price', '/quote');
  const totalPrice = requireString(raw, 'total_price', '/quote');
  const sellAmount = requireString(raw, 'sell_amount', '/quote');
  const buyAmount = requireString(raw, 'buy_amount', '/quote');

  const feeRaw = raw['fee'];
  if (!isRecord(feeRaw)) {
    throw new Sep38ParseError('SEP-38 /quote response is missing a "fee" object');
  }
  const feeTotal = requireString(feeRaw, 'total', '/quote fee');
  const feePercent = typeof feeRaw['percent'] === 'string' ? feeRaw['percent'] : undefined;

  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) {
    throw new Sep38ParseError(`SEP-38 quote "expires_at" is not a valid timestamp: "${expiresAt}"`);
  }
  if (expiresMs <= Date.now()) {
    throw new Sep38ParseError(`SEP-38 quote "expires_at" is not in the future: "${expiresAt}"`);
  }

  return {
    id,
    expires_at: expiresAt,
    price,
    total_price: totalPrice,
    sell_amount: sellAmount,
    buy_amount: buyAmount,
    fee: feePercent !== undefined ? { total: feeTotal, percent: feePercent } : { total: feeTotal },
    context,
  };
}

// ─── Firm quote endpoint ──────────────────────────────────────────────────────

/**
 * Creates a firm SEP-38 quote via POST /quote. Authenticated with a SEP-10 JWT.
 *
 * Firm quotes are single-use and time-bound, so the response is not cached. The
 * returned quote is validated to have a parsable `expires_at` in the future;
 * otherwise a {@link Sep38ParseError} is thrown.
 */
export async function postSep38Quote(
  quoteServer: string,
  jwt: string,
  params: Sep38QuoteParams
): Promise<Sep38Quote> {
  const base = normalizeQuoteServer(quoteServer);

  if (!jwt) throw new Sep38ParseError('A SEP-10 JWT is required to request a firm quote');
  if (!params.sell_asset || !params.buy_asset || !params.sell_amount) {
    throw new Sep38ParseError('sell_asset, buy_asset and sell_amount are required');
  }

  const body: Record<string, string> = {
    sell_asset: params.sell_asset,
    buy_asset: params.buy_asset,
    sell_amount: params.sell_amount,
    context: params.context,
  };
  if (params.buy_delivery_method) body['buy_delivery_method'] = params.buy_delivery_method;
  if (params.sell_delivery_method) body['sell_delivery_method'] = params.sell_delivery_method;
  if (params.country_code) body['country_code'] = params.country_code;
  if (params.expire_after) body['expire_after'] = params.expire_after;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${base}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`SEP-38 /quote request to ${base} timed out after 10 seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${base} SEP-38 /quote endpoint`);
  }

  return parseQuote((await res.json()) as Record<string, unknown>, params.context);
}

// ─── Quote cancellation endpoint ─────────────────────────────────────────────

/**
 * Cancels an unused firm quote before it expires via DELETE /quote/:id,
 * authenticated with a SEP-10 JWT.
 *
 * Idempotent: 404/410 responses (already cancelled or expired) are treated as
 * a successful no-op so a repeat cancellation does not throw.
 */
export async function deleteSep38Quote(
  quoteServer: string,
  id: string,
  jwt: string
): Promise<void> {
  const base = normalizeQuoteServer(quoteServer);

  if (!id) throw new Sep38ParseError('A quote id is required to cancel a quote');
  if (!jwt) throw new Sep38ParseError('A SEP-10 JWT is required to cancel a quote');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${base}/quote/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`SEP-38 /quote cancellation to ${base} timed out after 10 seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // Idempotent: already-cancelled or expired quotes return 404/410 — treat as success.
  if (res.ok || res.status === 404 || res.status === 410) {
    return;
  }

  throw new Error(`HTTP ${res.status} from ${base} SEP-38 /quote cancellation`);
}

// ─── Quote expiry tracking ───────────────────────────────────────────────────

export type QuoteExpiryQuote = {
  expiresAt?: Date | string;
  expires_at?: string;
};

function getQuoteExpiryTime(quote: QuoteExpiryQuote): number {
  const expiresAt = quote.expiresAt ?? quote.expires_at;

  if (expiresAt === undefined) {
    throw new Sep38ParseError('SEP-38 quote is missing an expiry timestamp');
  }

  const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (Number.isNaN(expiryTime)) {
    throw new Sep38ParseError('SEP-38 quote expiry timestamp is invalid');
  }

  return expiryTime;
}

/** Returns whole seconds remaining before a SEP-38 quote expires. */
export function getRemainingSeconds(quote: QuoteExpiryQuote): number {
  return Math.floor((getQuoteExpiryTime(quote) - Date.now()) / 1000);
}

/** Returns true when the quote is expired at the current time. */
export function isQuoteExpired(quote: QuoteExpiryQuote): boolean {
  return getRemainingSeconds(quote) <= 0;
}

export class QuoteExpiredEvent<TQuote extends QuoteExpiryQuote = QuoteExpiryQuote> extends Event {
  readonly quote: TQuote;

  constructor(quote: TQuote) {
    super('isExpired', { bubbles: true });
    this.quote = quote;
  }
}

export function watchQuoteExpiry<TQuote extends QuoteExpiryQuote>(
  quote: TQuote,
  target?: EventTarget
): { target: EventTarget; abort: () => void } {
  const emitter = target ?? new EventTarget();
  let aborted = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const emitExpiry = () => {
    if (!aborted) {
      emitter.dispatchEvent(new QuoteExpiredEvent(quote));
    }
  };

  timeoutId = setTimeout(emitExpiry, Math.max(0, getQuoteExpiryTime(quote) - Date.now()));

  return {
    target: emitter,
    abort: () => {
      aborted = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}

export function onQuoteExpired<TQuote extends QuoteExpiryQuote>(
  quote: TQuote,
  callback: (expiredQuote: TQuote) => void,
  target?: EventTarget
): () => void {
  const { target: emitter, abort } = watchQuoteExpiry(quote, target);

  const listener = (event: Event) => {
    if (event instanceof QuoteExpiredEvent) {
      callback(event.quote as TQuote);
    }
  };

  emitter.addEventListener('isExpired', listener);

  return () => {
    emitter.removeEventListener('isExpired', listener);
    abort();
  };
}
