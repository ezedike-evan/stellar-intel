import { StellarToml } from '@stellar/stellar-sdk';
import type { ResolvedAnchor, Sep1TomlData } from '@/types';
import { ANCHORS } from './anchors';

// ─── In-memory cache ──────────────────────────────────────────────────────────

const TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  data: Sep1TomlData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Resolves a stellar.toml file for the given domain via SEP-1.
 * Results are cached in memory for 1 hour. Failed resolutions are not cached.
 */
export async function resolveToml(domain: string): Promise<Sep1TomlData> {
  const cached = cache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let raw: Record<string, unknown>;
  try {
    raw = await StellarToml.Resolver.resolve(domain);
  } catch (err) {
    cache.delete(domain);
    throw new Error(
      `Failed to resolve stellar.toml for "${domain}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const transferServer =
    typeof raw['TRANSFER_SERVER_SEP0024'] === 'string' ? raw['TRANSFER_SERVER_SEP0024'] : undefined;
  const webAuthEndpoint =
    typeof raw['WEB_AUTH_ENDPOINT'] === 'string' ? raw['WEB_AUTH_ENDPOINT'] : undefined;
  const signingKey = typeof raw['SIGNING_KEY'] === 'string' ? raw['SIGNING_KEY'] : undefined;
  const quoteServer = typeof raw['QUOTE_SERVER'] === 'string' ? raw['QUOTE_SERVER'] : undefined;
  const kycServer = typeof raw['KYC_SERVER'] === 'string' ? raw['KYC_SERVER'] : undefined;

  const data: Sep1TomlData = {
    TRANSFER_SERVER_SEP0024: transferServer,
    WEB_AUTH_ENDPOINT: webAuthEndpoint,
    SIGNING_KEY: signingKey,
    CURRENCIES: Array.isArray(raw['CURRENCIES'])
      ? (raw['CURRENCIES'] as Array<{ code: string; issuer?: string }>)
      : undefined,
    capabilities: {
      sep10: Boolean(webAuthEndpoint),
      sep24: Boolean(transferServer),
      sep38: Boolean(quoteServer),
      sep12: Boolean(kycServer),
    },
  };

  cache.set(domain, { data, expiresAt: Date.now() + TTL_MS });
  return data;
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/**
 * Returns the SEP-24 transfer server URL for the given anchor domain.
 */
export async function getTransferServer(domain: string): Promise<string> {
  const toml = await resolveToml(domain);
  if (!toml.TRANSFER_SERVER_SEP0024) {
    throw new Error(`Anchor "${domain}" does not support SEP-24.`);
  }
  return toml.TRANSFER_SERVER_SEP0024;
}

/**
 * Returns the SEP-10 web auth endpoint URL for the given anchor domain.
 */
export async function getWebAuthEndpoint(domain: string): Promise<string> {
  const toml = await resolveToml(domain);
  if (!toml.WEB_AUTH_ENDPOINT) {
    throw new Error(`Anchor "${domain}" does not support SEP-10 authentication.`);
  }
  return toml.WEB_AUTH_ENDPOINT;
}

// ─── Bulk resolver ────────────────────────────────────────────────────────────

/**
 * Resolves stellar.toml for all known anchors in parallel.
 * Anchors that fail resolution are logged but do not cause the function to throw.
 */
export async function resolveAllAnchors(): Promise<Record<string, ResolvedAnchor>> {
  const results = await Promise.allSettled(
    ANCHORS.map((anchor) => resolveToml(anchor.homeDomain).then((data) => ({ anchor, data })))
  );

  const resolved: Record<string, ResolvedAnchor> = {};

  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolved[result.value.anchor.id] = result.value.data;
    } else {
      console.warn('[sep1] resolveAllAnchors failure:', result.reason);
    }
  }

  return resolved;
}

/** Exposed for testing only — clears the in-memory TOML cache. */
export function _clearTomlCache(): void {
  cache.clear();
}
