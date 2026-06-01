import { parseSepErrorBody } from './errors';
import type { Sep38Quote } from '@/types';

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
  const res = await fetch(buildPriceUrl(params), {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw parseSepErrorBody(body, res.status);
  }

  return parsePriceResponse(await res.json());
}

// ─── Quote expiry tracking ────────────────────────────────────────────────────

/**
 * Calculates the remaining seconds until a quote expires.
 * Returns a negative value if the quote has already expired.
 *
 * @param quote - The SEP-38 quote to check
 * @returns Number of seconds remaining until expiry, or negative if expired
 */
export function getRemainingSeconds(quote: Sep38Quote): number {
  const now = new Date();
  const expiresAtTime =
    quote.expiresAt instanceof Date
      ? quote.expiresAt.getTime()
      : new Date(quote.expiresAt).getTime();
  const nowTime = now.getTime();
  return Math.floor((expiresAtTime - nowTime) / 1000);
}

/**
 * Checks if a quote has expired based on the current time.
 *
 * @param quote - The SEP-38 quote to check
 * @returns true if the quote has expired, false otherwise
 */
export function isQuoteExpired(quote: Sep38Quote): boolean {
  return getRemainingSeconds(quote) <= 0;
}

// ─── Quote expiry event emitter ───────────────────────────────────────────────

/**
 * Custom event for quote expiry.
 * Emitted when a watched quote expires before any attempt to use it.
 */
export class QuoteExpiredEvent extends Event {
  readonly quote: Sep38Quote;

  constructor(quote: Sep38Quote) {
    super('isExpired', { bubbles: true });
    this.quote = quote;
  }
}

/**
 * Watches a quote for expiry and emits an event when it expires.
 * Returns a cleanup function to cancel the watch.
 *
 * @param quote - The SEP-38 quote to watch
 * @param target - Optional EventTarget to emit the event on (defaults to a new EventTarget)
 * @returns An object with the EventTarget and an abort function to stop watching
 */
export function watchQuoteExpiry(
  quote: Sep38Quote,
  target?: EventTarget
): { target: EventTarget; abort: () => void } {
  const emitter = target || new EventTarget();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let aborted = false;

  function scheduleExpiry() {
    const remaining = getRemainingSeconds(quote);

    // Queue already-expired quotes so listeners added immediately after
    // watchQuoteExpiry() still receive the event.
    if (remaining <= 0) {
      timeoutId = setTimeout(() => {
        if (!aborted) {
          emitter.dispatchEvent(new QuoteExpiredEvent(quote));
        }
      }, 0);
      return;
    }

    // Schedule expiry check for when the quote should expire
    // Add a small buffer (100ms) to ensure we catch it after it expires
    timeoutId = setTimeout(
      () => {
        if (!aborted) {
          emitter.dispatchEvent(new QuoteExpiredEvent(quote));
        }
      },
      (remaining + 0.1) * 1000
    );
  }

  scheduleExpiry();

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

/**
 * Adds a listener for quote expiry events on the given target.
 * Automatically raises an error (through the event) before any attempt to use the quote.
 *
 * @param quote - The SEP-38 quote to monitor
 * @param callback - Function to call when the quote expires
 * @param target - Optional EventTarget to listen on (defaults to a new EventTarget)
 * @returns A cleanup function to remove the listener and stop watching
 */
export function onQuoteExpired(
  quote: Sep38Quote,
  callback: (expiredQuote: Sep38Quote) => void,
  target?: EventTarget
): () => void {
  const { target: emitter, abort } = watchQuoteExpiry(quote, target);

  const listener = (event: Event) => {
    if (event instanceof QuoteExpiredEvent) {
      callback(event.quote);
    }
  };

  emitter.addEventListener('isExpired', listener);

  return () => {
    emitter.removeEventListener('isExpired', listener);
    abort();
  };
}
