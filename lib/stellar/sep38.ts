import type { Sep38Asset, Sep38DeliveryMethod, Sep38Info } from '@/types';

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

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exposed for testing only — clears the in-memory SEP-38 /info cache. */
export function _clearSep38Cache(): void {
  cache.clear();
}
