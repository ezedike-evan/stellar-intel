import { StellarToml } from '@stellar/stellar-sdk'
import type { ResolvedAnchor, Sep1TomlData } from '@/types'
import { ANCHORS } from './anchors'

// ─── Result type ──────────────────────────────────────────────────────────────

export type TomlResult =
  | { ok: true; data: Sep1TomlData }
  | { ok: false; error: string }

// ─── In-memory cache ──────────────────────────────────────────────────────────

const TTL_MS = 60 * 60 * 1000 // 1 hour

interface CacheEntry {
  data: Sep1TomlData
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

// ─── Retry configuration ──────────────────────────────────────────────────────

const RETRY_CONFIG = {
  maxAttempts: 3,     // 1 initial + 2 retries
  baseDelayMs: 250,   // 250 ms base
  backoffFactor: 2,   // 2× exponential: 250 → 500 → 1000
  totalBudgetMs: 5000 // hard ceiling across all attempts
} as const

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config = RETRY_CONFIG
): Promise<T> {
  const deadline = Date.now() + config.totalBudgetMs
  let lastError: unknown

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      // No more attempts or budget exhausted — bail out immediately
      const isLastAttempt = attempt === config.maxAttempts - 1
      const delayMs = config.baseDelayMs * config.backoffFactor ** attempt
      const wouldExceedBudget = Date.now() + delayMs > deadline

      if (isLastAttempt || wouldExceedBudget) break

      await sleep(delayMs)
    }
  }

  throw lastError
}

// ─── Core resolver (internal — throws on failure) ────────────────────────────

async function resolveTomlUnsafe(domain: string): Promise<Sep1TomlData> {
  const cached = cache.get(domain)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  let raw: Record<string, unknown>
  try {
    raw = await withRetry(() => StellarToml.Resolver.resolve(domain))
  } catch (err) {
    cache.delete(domain)
    throw new Error(
      `Failed to resolve stellar.toml for "${domain}": ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const transferServer = typeof raw['TRANSFER_SERVER_SEP0024'] === 'string' ? raw['TRANSFER_SERVER_SEP0024'] : undefined
  const webAuthEndpoint = typeof raw['WEB_AUTH_ENDPOINT'] === 'string' ? raw['WEB_AUTH_ENDPOINT'] : undefined
  const signingKey = typeof raw['SIGNING_KEY'] === 'string' ? raw['SIGNING_KEY'] : undefined
  const quoteServer = typeof raw['QUOTE_SERVER'] === 'string' ? raw['QUOTE_SERVER'] : undefined

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
      sep12: Boolean(signingKey),
    },
  }

  cache.set(domain, { data, expiresAt: Date.now() + TTL_MS })
  return data
}

// ─── Public safe resolver (never throws) ─────────────────────────────────────
export async function resolveToml(domain: string): Promise<TomlResult> {
  try {
    const data = await resolveTomlUnsafe(domain)
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────
export async function getTransferServer(domain: string): Promise<string | null> {
  const result = await resolveToml(domain)
  return result.ok ? (result.data.TRANSFER_SERVER_SEP0024 ?? null) : null
}

export async function getWebAuthEndpoint(domain: string): Promise<string | null> {
  const result = await resolveToml(domain)
  return result.ok ? (result.data.WEB_AUTH_ENDPOINT ?? null) : null
}

// ─── Bulk resolver ────────────────────────────────────────────────────────────

/**
 * Resolves stellar.toml for all known anchors in parallel.
 * Anchors that fail resolution are logged but do not cause the function to throw.
 */
export async function resolveAllAnchors(): Promise<Record<string, ResolvedAnchor>> {
  const results = await Promise.allSettled(
    ANCHORS.map((anchor) =>
      resolveTomlUnsafe(anchor.homeDomain).then((data) => ({ anchor, data }))
    )
  )

  const resolved: Record<string, ResolvedAnchor> = {}

  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolved[result.value.anchor.id] = result.value.data
    } else {
      console.warn('[sep1] resolveAllAnchors failure:', result.reason)
    }
  }

  return resolved
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exposed for testing only — clears the in-memory TOML cache. */
export function _clearTomlCache(): void {
  cache.clear()
}

/** Exposed for testing only — injects a pre-validated cache entry. */
export function _seedTomlCache(domain: string, data: Sep1TomlData): void {
  cache.set(domain, { data, expiresAt: Date.now() + TTL_MS })
}