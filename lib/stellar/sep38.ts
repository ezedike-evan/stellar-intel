import { parseSepErrorBody } from './errors';
import type { Sep1TomlData } from '@/types';
import { Sep38PriceSchema } from './sep38-schemas';
import type { Sep38Price } from './sep38-schemas';
export type { Sep38Price, Sep38Prices, Sep38Info, Sep38Quote } from './sep38-schemas';

const PRICE_PATH = '/price';

export interface Sep38PriceParams {
  quoteServer: string;
  sell_asset: string;
  buy_asset: string;
  sell_amount: string;
  buy_delivery_method?: string;
  context: string;
}

function assertNonEmpty(value: string, fieldName: keyof Sep38PriceParams): void {
  if (value.trim().length === 0) {
    throw new Error(`SEP-38 /price requires a non-empty "${fieldName}"`);
  }
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

/**
 * Fetches an indicative SEP-38 price for a specific asset pair.
 *
 * This wraps GET /price and intentionally supports the sell_amount path needed
 * by the off-ramp comparator. Firm quotes belong to POST /quote.
 */
export async function getSep38Price(params: Sep38PriceParams): Promise<Sep38Price> {
  const url = buildPriceUrl(params);
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw parseSepErrorBody(body, res.status);
  }

  const result = Sep38PriceSchema.safeParse(await res.json());
  if (!result.success) {
    throw new Error(`SEP-38 /price response schema error: ${result.error.message}`);
  }
  return result.data;
}
