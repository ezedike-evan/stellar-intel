import { parseSepErrorBody } from './errors';
import { authenticate, invalidateSep10Token } from './sep10';
import type { ResolvedAnchor } from '@/types';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequiredString(
  data: Record<string, unknown>,
  fieldName: string,
  context = '/price'
): string {
  const value = data[fieldName];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid SEP-38 ${context} response: missing "${fieldName}"`);
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

// ─── Firm quotes (authenticated) ─────────────────────────────────────────────

/** Parameters for a SEP-38 firm quote (POST /quote). */
export interface Sep38FirmQuoteRequest {
  /** Asset the user is selling, in SEP-38 form (e.g. "stellar:USDC:G..."). */
  sellAsset: string;
  /** Asset the user wants to buy, in SEP-38 form (e.g. "iso4217:NGN"). */
  buyAsset: string;
  /** Amount of sellAsset. Mutually exclusive with buyAmount. */
  sellAmount?: string;
  /** Amount of buyAsset. Mutually exclusive with sellAmount. */
  buyAmount?: string;
  /** Flow the quote will be used in. Defaults to the anchor's choice when omitted. */
  context?: 'sep6' | 'sep24' | 'sep31';
  sellDeliveryMethod?: string;
  buyDeliveryMethod?: string;
  countryCode?: string;
  /** ISO-8601 timestamp the quote must remain valid until. */
  expireAfter?: string;
}

/** A firm quote issued by an anchor's SEP-38 quote server (POST /quote). */
export interface Sep38FirmQuote {
  id: string;
  expiresAt: Date;
  price: string;
  totalPrice: string;
  sellAsset: string;
  sellAmount: string;
  buyAsset: string;
  buyAmount: string;
  fee?: Sep38Fee;
}

function getQuoteServer(anchor: ResolvedAnchor): string {
  const server = anchor.ANCHOR_QUOTE_SERVER;
  if (!server || !anchor.capabilities.sep38) {
    throw new Error(`Anchor "${anchor.homeDomain}" does not support SEP-38 firm quotes.`);
  }
  return server.replace(/\/+$/, '');
}

async function readErrorBody(res: Response): Promise<unknown> {
  return typeof res.json === 'function' ? await res.json().catch(() => null) : null;
}

/**
 * Runs an authenticated request against the anchor, transparently refreshing the
 * SEP-10 JWT on a 401.
 *
 * The first attempt uses whatever token `authenticate` returns (cached when
 * valid). If the anchor rejects it with 401, the cached token is dropped via
 * `invalidateSep10Token` and a single fresh sign flow is run before re-attempting
 * exactly once. A second 401 is surfaced to the caller rather than looping.
 */
async function authenticatedRequest(
  anchor: ResolvedAnchor,
  publicKey: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  const withAuth = (jwt: string): RequestInit => ({
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${jwt}` },
  });

  const { jwt } = await authenticate(anchor, publicKey);
  const res = await fetch(url, withAuth(jwt));

  if (res.status !== 401) return res;

  // Token was stale/revoked — drop it and re-authenticate once, then retry.
  invalidateSep10Token(anchor.homeDomain, publicKey);
  const { jwt: freshJwt } = await authenticate(anchor, publicKey);
  return fetch(url, withAuth(freshJwt));
}

function toFirmQuoteBody(params: Sep38FirmQuoteRequest): Record<string, string> {
  const body: Record<string, string> = {
    sell_asset: params.sellAsset,
    buy_asset: params.buyAsset,
  };
  if (params.sellAmount !== undefined) body['sell_amount'] = params.sellAmount;
  if (params.buyAmount !== undefined) body['buy_amount'] = params.buyAmount;
  if (params.context !== undefined) body['context'] = params.context;
  if (params.sellDeliveryMethod !== undefined) body['sell_delivery_method'] = params.sellDeliveryMethod;
  if (params.buyDeliveryMethod !== undefined) body['buy_delivery_method'] = params.buyDeliveryMethod;
  if (params.countryCode !== undefined) body['country_code'] = params.countryCode;
  if (params.expireAfter !== undefined) body['expire_after'] = params.expireAfter;
  return body;
}

function parseFirmQuote(data: unknown): Sep38FirmQuote {
  if (!isRecord(data)) {
    throw new Error('Invalid SEP-38 /quote response: expected an object');
  }

  const expiresAtRaw = getRequiredString(data, 'expires_at', '/quote');
  const expiresAt = new Date(expiresAtRaw);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error(`Invalid SEP-38 /quote response: "expires_at" is not a valid date: "${expiresAtRaw}"`);
  }

  const quote: Sep38FirmQuote = {
    id: getRequiredString(data, 'id', '/quote'),
    expiresAt,
    price: getRequiredString(data, 'price', '/quote'),
    totalPrice: getRequiredString(data, 'total_price', '/quote'),
    sellAsset: getRequiredString(data, 'sell_asset', '/quote'),
    sellAmount: getRequiredString(data, 'sell_amount', '/quote'),
    buyAsset: getRequiredString(data, 'buy_asset', '/quote'),
    buyAmount: getRequiredString(data, 'buy_amount', '/quote'),
  };

  const fee = parseFee(data['fee']);
  if (fee) quote.fee = fee;

  return quote;
}

/**
 * Requests a firm quote from the anchor's SEP-38 quote server (POST /quote).
 *
 * Requires the anchor's SEP-10 JWT; the token is fetched from (or refreshed
 * into) the shared JWT cache via `authenticate` and automatically renewed once
 * on a 401. Throws a `SepError` on any other non-2xx response.
 */
export async function requestFirmQuote(
  anchor: ResolvedAnchor,
  publicKey: string,
  params: Sep38FirmQuoteRequest
): Promise<Sep38FirmQuote> {
  const quoteServer = getQuoteServer(anchor);
  const url = `${quoteServer}/quote`;
  const body = JSON.stringify(toFirmQuoteBody(params));

  const res = await authenticatedRequest(anchor, publicKey, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw parseSepErrorBody(await readErrorBody(res), res.status);
  }

  return parseFirmQuote(await res.json());
}

/**
 * Deletes a previously issued firm quote (DELETE /quote/:id).
 *
 * Requires the anchor's SEP-10 JWT and, like {@link requestFirmQuote},
 * auto-refreshes the token once on a 401. Throws a `SepError` on failure.
 */
export async function deleteFirmQuote(
  anchor: ResolvedAnchor,
  publicKey: string,
  quoteId: string
): Promise<void> {
  const quoteServer = getQuoteServer(anchor);
  const url = `${quoteServer}/quote/${encodeURIComponent(quoteId)}`;

  const res = await authenticatedRequest(anchor, publicKey, url, { method: 'DELETE' });

  if (!res.ok) {
    throw parseSepErrorBody(await readErrorBody(res), res.status);
  }
}
