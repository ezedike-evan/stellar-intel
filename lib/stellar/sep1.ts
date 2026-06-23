import { StellarToml } from '@stellar/stellar-sdk';
import type { ResolvedAnchor, Sep1TomlData } from '@/types';
import { ANCHORS } from './anchors';

// ─── Result type ──────────────────────────────────────────────────────────────

export type TomlResult = { ok: true; data: Sep1TomlData } | { ok: false; error: string };

// ─── In-memory cache ──────────────────────────────────────────────────────────

const TTL_MS = 15 * 60 * 1000; // 15 minutes

// ─── Retry policy ─────────────────────────────────────────────────────────────

const TOML_MAX_ATTEMPTS = 3;
const TOML_RETRY_BASE_MS = 250; // exponential backoff base: 250ms, 500ms, …
const TOML_RETRY_BUDGET_MS = 5000; // wall-clock budget; stop before exceeding it

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CacheEntry {
  data: Sep1TomlData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function normalizeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();

  if (!normalized) {
    throw new Error('Anchor domain is required');
  }

  return normalized;
}

function getString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getCurrencies(raw: Record<string, unknown>): Sep1TomlData['CURRENCIES'] {
  const currencies = raw['CURRENCIES'];
  if (!Array.isArray(currencies)) {
    return [];
  }

  return currencies.flatMap((currency) => {
    if (!isRecord(currency) || typeof currency['code'] !== 'string') {
      return [];
    }

    const parsed: Sep1TomlData['CURRENCIES'][number] = {
      code: currency['code'],
    };

    if (typeof currency['issuer'] === 'string') {
      parsed.issuer = currency['issuer'];
    }

    return [parsed];
  });
}

function toSep1TomlData(domain: string, raw: Record<string, unknown>): Sep1TomlData {
  const transferServer = getString(raw, 'TRANSFER_SERVER_SEP0024');
  const webAuthEndpoint = getString(raw, 'WEB_AUTH_ENDPOINT');
  const signingKey = getString(raw, 'SIGNING_KEY');
  const quoteServer = getString(raw, 'ANCHOR_QUOTE_SERVER');

  return {
    domain,
    TRANSFER_SERVER_SEP0024: transferServer,
    ANCHOR_QUOTE_SERVER: quoteServer,
    WEB_AUTH_ENDPOINT: webAuthEndpoint,
    SIGNING_KEY: signingKey,
    NETWORK_PASSPHRASE: getString(raw, 'NETWORK_PASSPHRASE'),
    ORG_URL: getString(raw, 'ORG_URL'),
    ORG_SUPPORT_EMAIL: getString(raw, 'ORG_SUPPORT_EMAIL'),
    ORG_SUPPORT_URL: getString(raw, 'ORG_SUPPORT_URL'),
    CURRENCIES: getCurrencies(raw),
    capabilities: {
      sep10: Boolean(webAuthEndpoint),
      sep24: Boolean(transferServer),
      /** Derived from ANCHOR_QUOTE_SERVER presence — the authoritative source for SEP-38 capability. */
      sep38: Boolean(quoteServer),
      sep12: Boolean(signingKey),
    },
  };
}

function requireTomlField(
  domain: string,
  toml: Sep1TomlData,
  field: 'TRANSFER_SERVER_SEP0024' | 'WEB_AUTH_ENDPOINT',
  protocolName: string
): string {
  const value = toml[field];

  if (!value) {
    throw new Error(
      `Missing ${field} in stellar.toml for "${domain}". ` +
        `This anchor does not support ${protocolName}.`
    );
  }

  return value;
}

/**
 * Resolves a clickable support href from SEP-1 documentation fields.
 * Priority: ORG_SUPPORT_URL → mailto:ORG_SUPPORT_EMAIL → ORG_URL (https only).
 */
export function resolveAnchorSupportHref(toml: Sep1TomlData): string | null {
  const supportUrl = toml.ORG_SUPPORT_URL;
  if (supportUrl?.startsWith('https://') || supportUrl?.startsWith('http://')) {
    return supportUrl;
  }

  const email = toml.ORG_SUPPORT_EMAIL;
  if (email) {
    return `mailto:${email}`;
  }

  const orgUrl = toml.ORG_URL;
  if (orgUrl?.startsWith('https://')) {
    return orgUrl;
  }

  return null;
}

/**
 * Resolves an anchor stellar.toml file via SEP-1.
 * Results are cached in memory for 15 minutes. Failed resolutions are not cached.
 */
export async function resolveAnchor(domain: string): Promise<Sep1TomlData> {
  const cacheKey = normalizeDomain(domain);
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Retry transient resolution failures with exponential backoff, bounded by a
  // wall-clock budget so a slow anchor can't stall the caller indefinitely.
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= TOML_MAX_ATTEMPTS; attempt++) {
    try {
      const raw = (await StellarToml.Resolver.resolve(cacheKey)) as Record<string, unknown>;
      const data = toSep1TomlData(cacheKey, raw);

      cache.set(cacheKey, { data, expiresAt: Date.now() + TTL_MS });
      return data;
    } catch (err) {
      lastError = err;

      if (attempt < TOML_MAX_ATTEMPTS) {
        const delay = TOML_RETRY_BASE_MS * 2 ** (attempt - 1);
        if (Date.now() - start + delay <= TOML_RETRY_BUDGET_MS) {
          await sleep(delay);
          continue;
        }
      }
      break;
    }
  }

  cache.delete(cacheKey);
  throw new Error(
    `Failed to resolve stellar.toml for "${cacheKey}": ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

// ─── Public safe resolver (never throws) ─────────────────────────────────────

/**
 * Backwards-compatible wrapper around resolveAnchor.
 * Returns a TomlResult discriminated union so existing callers that check
 * `result.ok` continue to compile and run without changes.
 */
export async function resolveToml(domain: string): Promise<TomlResult> {
  try {
    const data = await resolveAnchor(domain);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Returns the SEP-24 transfer server URL for the given anchor domain.
 */
export async function getTransferServer(domain: string): Promise<string> {
  const toml = await resolveAnchor(domain);
  return requireTomlField(domain, toml, 'TRANSFER_SERVER_SEP0024', 'SEP-24');
}

/**
 * Returns the SEP-10 web auth endpoint URL for the given anchor domain.
 */
export async function getWebAuthEndpoint(domain: string): Promise<string> {
  const toml = await resolveAnchor(domain);
  return requireTomlField(domain, toml, 'WEB_AUTH_ENDPOINT', 'SEP-10 authentication');
}

/**
 * Resolves stellar.toml for all known anchors in parallel.
 * Anchors that fail resolution are skipped.
 */
export async function resolveAllAnchors(): Promise<Record<string, ResolvedAnchor>> {
  const results = await Promise.allSettled(
    ANCHORS.map((anchor) => resolveAnchor(anchor.homeDomain).then((data) => ({ anchor, data })))
  );

  const resolved: Record<string, ResolvedAnchor> = {};

  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolved[result.value.anchor.id] = { ...result.value.anchor, ...result.value.data };
    } else {
      // eslint-disable-next-line no-console
      console.warn('[sep1] resolveAllAnchors failure:', result.reason);
    }
  }

  return resolved;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exposed for testing only — clears the in-memory TOML cache. */
export function _clearTomlCache(): void {
  cache.clear();
}

/** Exposed for testing only — injects a pre-validated cache entry. */
export function _seedTomlCache(domain: string, data: Sep1TomlData): void {
  cache.set(domain, { data, expiresAt: Date.now() + TTL_MS });
}
