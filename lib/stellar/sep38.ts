import { parseSepErrorBody } from './errors';

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
