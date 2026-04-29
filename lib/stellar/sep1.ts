import { StellarToml } from '@stellar/stellar-sdk'
import type { ResolvedAnchor, Sep1TomlData } from '@/types'
import { ANCHORS } from './anchors'

const TTL_MS = 15 * 60 * 1000 // 15 minutes

interface CacheEntry {
  data: Sep1TomlData
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function normalizeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase()

  if (!normalized) {
    throw new Error('Anchor domain is required')
  }

  return normalized
}

function getString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getCurrencies(raw: Record<string, unknown>): Sep1TomlData['CURRENCIES'] {
  const currencies = raw['CURRENCIES']
  if (!Array.isArray(currencies)) {
    return []
  }

  return currencies.flatMap((currency) => {
    if (!isRecord(currency) || typeof currency['code'] !== 'string') {
      return []
    }

    const parsed: Sep1TomlData['CURRENCIES'][number] = {
      code: currency['code'],
    }

    if (typeof currency['issuer'] === 'string') {
      parsed.issuer = currency['issuer']
    }

    return [parsed]
  })
}

function toSep1TomlData(domain: string, raw: Record<string, unknown>): Sep1TomlData {
  return {
    domain,
    TRANSFER_SERVER_SEP0024: getString(raw, 'TRANSFER_SERVER_SEP0024'),
    ANCHOR_QUOTE_SERVER: getString(raw, 'ANCHOR_QUOTE_SERVER'),
    WEB_AUTH_ENDPOINT: getString(raw, 'WEB_AUTH_ENDPOINT'),
    SIGNING_KEY: getString(raw, 'SIGNING_KEY'),
    NETWORK_PASSPHRASE: getString(raw, 'NETWORK_PASSPHRASE'),
    CURRENCIES: getCurrencies(raw),
  }
}

function requireTomlField(
  domain: string,
  toml: Sep1TomlData,
  field: 'TRANSFER_SERVER_SEP0024' | 'WEB_AUTH_ENDPOINT',
  protocolName: string
): string {
  const value = toml[field]

  if (!value) {
    throw new Error(
      `Missing ${field} in stellar.toml for "${domain}". ` +
        `This anchor does not support ${protocolName}.`
    )
  }

  return value
}

/**
 * Resolves an anchor stellar.toml file via SEP-1.
 * Results are cached in memory for 15 minutes. Failed resolutions are not cached.
 */
export async function resolveAnchor(domain: string): Promise<Sep1TomlData> {
  const cacheKey = normalizeDomain(domain)
  const cached = cache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  try {
    const raw = (await StellarToml.Resolver.resolve(cacheKey)) as Record<string, unknown>
    const data = toSep1TomlData(cacheKey, raw)

    cache.set(cacheKey, { data, expiresAt: Date.now() + TTL_MS })
    return data
  } catch (err) {
    cache.delete(cacheKey)
    throw new Error(
      `Failed to resolve stellar.toml for "${cacheKey}": ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

/** Backwards-compatible name used by older SEP-1 callers. */
export async function resolveToml(domain: string): Promise<Sep1TomlData> {
  return resolveAnchor(domain)
}

/**
 * Returns the SEP-24 transfer server URL for the given anchor domain.
 */
export async function getTransferServer(domain: string): Promise<string> {
  const toml = await resolveAnchor(domain)
  return requireTomlField(domain, toml, 'TRANSFER_SERVER_SEP0024', 'SEP-24')
}

/**
 * Returns the SEP-10 web auth endpoint URL for the given anchor domain.
 */
export async function getWebAuthEndpoint(domain: string): Promise<string> {
  const toml = await resolveAnchor(domain)
  return requireTomlField(domain, toml, 'WEB_AUTH_ENDPOINT', 'SEP-10 authentication')
}

/**
 * Resolves stellar.toml for all known anchors in parallel.
 * Anchors that fail resolution are skipped.
 */
export async function resolveAllAnchors(): Promise<Record<string, ResolvedAnchor>> {
  const results = await Promise.allSettled(
    ANCHORS.map((anchor) => resolveAnchor(anchor.homeDomain).then((data) => ({ anchor, data })))
  )

  const resolved: Record<string, ResolvedAnchor> = {}

  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolved[result.value.anchor.id] = result.value.data
    }
  }

  return resolved
}

/** Exposed for testing only - clears the in-memory TOML cache. */
export function _clearTomlCache(): void {
  cache.clear()
}

/** Exposed for testing only — injects a pre-validated cache entry. */
export function _seedTomlCache(domain: string, data: Sep1TomlData): void {
  cache.set(domain, { data, expiresAt: Date.now() + TTL_MS })
}