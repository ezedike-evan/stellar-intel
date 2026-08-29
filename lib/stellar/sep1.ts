import type { ResolvedAnchor, Sep1TomlData } from '@/types';
import { ANCHORS } from './anchors';
import { getCachedToml, setCachedToml, invalidateCachedToml, clearTomlCache } from './toml-cache';
import { sleep } from '@/lib/utils';

// ─── Result type ──────────────────────────────────────────────────────────────

export type TomlResult = { ok: true; data: Sep1TomlData } | { ok: false; error: string };

// ─── Retry policy ─────────────────────────────────────────────────────────────

const TOML_MAX_ATTEMPTS = 3;
const TOML_RETRY_BASE_MS = 250; // exponential backoff base: 250ms, 500ms, …
const TOML_RETRY_BUDGET_MS = 5000; // wall-clock budget; stop before exceeding it

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
  const sep6TransferServer = getString(raw, 'TRANSFER_SERVER');
  const directPaymentServer = getString(raw, 'DIRECT_PAYMENT_SERVER');

  return {
    domain,
    TRANSFER_SERVER_SEP0024: transferServer,
    TRANSFER_SERVER: sep6TransferServer,
    DIRECT_PAYMENT_SERVER: directPaymentServer,
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
      sep6: Boolean(sep6TransferServer),
      sep31: Boolean(directPaymentServer),
    },
    seps: [
      ...(sep6TransferServer ? (['sep6'] as const) : []),
      ...(transferServer ? (['sep24'] as const) : []),
      ...(quoteServer ? (['sep38'] as const) : []),
      ...(directPaymentServer ? (['sep31'] as const) : []),
    ],
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
 * Detects if a domain appears to be issuer-only (not hosting service endpoints).
 * Issuer-only domains typically contain issuer-specific subdomains (e.g., "mgusd.moneygram.com")
 * whereas service domains are generic service subdomains (e.g., "stellar.moneygram.com").
 *
 * @param homeDomain - The home domain to check
 * @param serviceDomain - Optional explicit service domain; if provided and different from homeDomain, homeDomain is issuer-only
 * @returns true if domain appears to be issuer-only, false otherwise
 */
export function isIssuerOnlyDomain(homeDomain: string, serviceDomain?: string): boolean {
  // If a service domain is explicitly provided and differs from home domain,
  // the home domain is issuer-only
  if (serviceDomain && serviceDomain !== homeDomain) {
    return true;
  }

  return false;
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

// ─── Toml integrity validation (Issue #D003) ───────────────────────────────────
//
// An anchor can silently break its stellar.toml — a malformed field, a missing
// required key, a rotated signing key — without ever going offline, so uptime
// alone never catches it. This validates the already-parsed `Sep1TomlData`
// against the SEP-1 required-field expectations, and optionally against the
// last known-good snapshot to flag drift (e.g. a changed SIGNING_KEY) without
// treating drift as fatal — a legitimate key rotation looks identical to a
// compromised one at this layer, so it's flagged, not silently accepted or
// auto-rejected.

/** One field-level integrity problem found in a stellar.toml. */
export interface TomlIntegrityIssue {
  field: string;
  reason: string;
}

/** Outcome of validating one stellar.toml snapshot. */
export interface TomlIntegrityResult {
  valid: boolean;
  issues: TomlIntegrityIssue[];
}

function isValidHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a resolved `Sep1TomlData` against the SEP-1 required-field
 * expectations: `SIGNING_KEY` must be present, and `TRANSFER_SERVER` /
 * `TRANSFER_SERVER_SEP0024` (when advertised) must be well-formed HTTPS URLs.
 * When `previous` (the last known-good snapshot for the same domain) is
 * supplied, a changed `SIGNING_KEY` is also flagged as drift.
 */
export function validateTomlIntegrity(
  toml: Sep1TomlData,
  previous?: Sep1TomlData | null
): TomlIntegrityResult {
  const issues: TomlIntegrityIssue[] = [];

  if (!toml.SIGNING_KEY) {
    issues.push({ field: 'SIGNING_KEY', reason: 'missing SIGNING_KEY' });
  }

  if (toml.TRANSFER_SERVER && !isValidHttpsUrl(toml.TRANSFER_SERVER)) {
    issues.push({
      field: 'TRANSFER_SERVER',
      reason: `malformed URL: "${toml.TRANSFER_SERVER}"`,
    });
  }

  if (toml.TRANSFER_SERVER_SEP0024 && !isValidHttpsUrl(toml.TRANSFER_SERVER_SEP0024)) {
    issues.push({
      field: 'TRANSFER_SERVER_SEP0024',
      reason: `malformed URL: "${toml.TRANSFER_SERVER_SEP0024}"`,
    });
  }

  if (previous?.SIGNING_KEY && toml.SIGNING_KEY && previous.SIGNING_KEY !== toml.SIGNING_KEY) {
    issues.push({
      field: 'SIGNING_KEY',
      reason: `signing key changed: was "${previous.SIGNING_KEY}", now "${toml.SIGNING_KEY}"`,
    });
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Resolves an anchor stellar.toml file via SEP-1.
 *
 * Results are cached in memory (TTL ~10 min) keyed by home domain. Pass
 * `{ bypassCache: true }` to force a fresh resolution — used by the nightly
 * validator so it always checks live anchor data. Failed resolutions are not
 * cached.
 */
export async function resolveAnchor(
  domain: string,
  opts: { bypassCache?: boolean } = {}
): Promise<Sep1TomlData> {
  const cacheKey = normalizeDomain(domain);

  if (!opts.bypassCache) {
    const cached = getCachedToml(cacheKey);
    if (cached) return cached;
  }

  // Dynamic import: @stellar/stellar-sdk ships ESM-flavored types that TS's
  // Node16 resolution (used by the standalone packages/mcp build) refuses to
  // `require()`-import statically — see packages/publisher/src/batch.ts for
  // the same workaround. The package itself is dual CJS/ESM at runtime.
  const { StellarToml } = await import('@stellar/stellar-sdk');

  // Retry transient resolution failures with exponential backoff, bounded by a
  // wall-clock budget so a slow anchor can't stall the caller indefinitely.
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= TOML_MAX_ATTEMPTS; attempt++) {
    try {
      const raw = (await StellarToml.Resolver.resolve(cacheKey)) as Record<string, unknown>;
      const data = toSep1TomlData(cacheKey, raw);

      setCachedToml(cacheKey, data);
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

  invalidateCachedToml(cacheKey);
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
 * For each anchor, uses serviceDomain if available, otherwise falls back to homeDomain.
 */
export async function resolveAllAnchors(): Promise<Record<string, ResolvedAnchor>> {
  const results = await Promise.allSettled(
    ANCHORS.map((anchor) => {
      // Use serviceDomain if provided, otherwise use homeDomain
      const domainToResolve = anchor.serviceDomain || anchor.homeDomain;
      return resolveAnchor(domainToResolve).then((data) => ({ anchor, data }));
    })
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
  clearTomlCache();
}

/** Exposed for testing only — injects a pre-validated cache entry. */
export function _seedTomlCache(domain: string, data: Sep1TomlData): void {
  setCachedToml(domain, data);
}
