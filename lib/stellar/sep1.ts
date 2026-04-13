import { StellarToml } from '@stellar/stellar-sdk'
import type { Sep1TomlData } from '@/types'
import { ANCHORS } from './anchors'

// ─── In-memory cache ──────────────────────────────────────────────────────────

const TTL_MS = 60 * 60 * 1000 // 1 hour

interface CacheEntry {
  data: Sep1TomlData
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Resolves a stellar.toml file for the given domain via SEP-1.
 * Results are cached in memory for 1 hour. Failed resolutions are not cached.
 */
export async function resolveToml(domain: string): Promise<Sep1TomlData> {
  const cached = cache.get(domain)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  let raw: Record<string, unknown>
  try {
    raw = await StellarToml.Resolver.resolve(domain)
  } catch (err) {
    cache.delete(domain)
    throw new Error(
      `Failed to resolve stellar.toml for "${domain}": ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const transferServer = raw['TRANSFER_SERVER_SEP0024']
  if (!transferServer || typeof transferServer !== 'string') {
    cache.delete(domain)
    throw new Error(
      `Missing TRANSFER_SERVER_SEP0024 in stellar.toml for "${domain}". ` +
        `This anchor does not support SEP-24.`
    )
  }

  const webAuthEndpoint = raw['WEB_AUTH_ENDPOINT']
  if (!webAuthEndpoint || typeof webAuthEndpoint !== 'string') {
    cache.delete(domain)
    throw new Error(
      `Missing WEB_AUTH_ENDPOINT in stellar.toml for "${domain}". ` +
        `This anchor does not support SEP-10 authentication.`
    )
  }

  const data: Sep1TomlData = {
    TRANSFER_SERVER_SEP0024: transferServer,
    WEB_AUTH_ENDPOINT: webAuthEndpoint,
    SIGNING_KEY: typeof raw['SIGNING_KEY'] === 'string' ? raw['SIGNING_KEY'] : undefined,
    CURRENCIES: Array.isArray(raw['CURRENCIES'])
      ? (raw['CURRENCIES'] as Array<{ code: string; issuer?: string }>)
      : undefined,
  }

  cache.set(domain, { data, expiresAt: Date.now() + TTL_MS })
  return data
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/**
 * Returns the SEP-24 transfer server URL for the given anchor domain.
 */
export async function getTransferServer(domain: string): Promise<string> {
  const toml = await resolveToml(domain)
  return toml.TRANSFER_SERVER_SEP0024
}

/**
 * Returns the SEP-10 web auth endpoint URL for the given anchor domain.
 */
export async function getWebAuthEndpoint(domain: string): Promise<string> {
  const toml = await resolveToml(domain)
  return toml.WEB_AUTH_ENDPOINT
}

// ─── Bulk resolver ────────────────────────────────────────────────────────────

/**
 * Resolves stellar.toml for all known anchors in parallel.
 * Anchors that fail resolution are logged but do not cause the function to throw.
 */
export async function resolveAllAnchors(): Promise<Record<string, Sep1TomlData>> {
  const results = await Promise.allSettled(
    ANCHORS.map((anchor) => resolveToml(anchor.homeDomain).then((data) => ({ anchor, data })))
  )

  const resolved: Record<string, Sep1TomlData> = {}

  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolved[result.value.anchor.id] = result.value.data
    } else {
      console.warn('[sep1] resolveAllAnchors failure:', result.reason)
    }
  }

  return resolved
}

/** Exposed for testing only — clears the in-memory TOML cache. */
export function _clearTomlCache(): void {
  cache.clear()
}
