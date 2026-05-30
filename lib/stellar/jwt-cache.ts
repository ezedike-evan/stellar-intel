import type { Sep10Auth } from '@/types'

const DEFAULT_CAPACITY = 32

const cache = new Map<string, Sep10Auth>()
let capacity = DEFAULT_CAPACITY

function key(anchorDomain: string, publicKey: string): string {
  return `${anchorDomain}::${publicKey}`
}

function evictIfOverCapacity(): void {
  while (cache.size > capacity) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function getCachedJwt(anchorDomain: string, publicKey: string): Sep10Auth | undefined {
  const k = key(anchorDomain, publicKey)
  const entry = cache.get(k)
  if (!entry) return undefined

  if (entry.expiresAt.getTime() <= Date.now()) {
    cache.delete(k)
    return undefined
  }

  // Move to end → most-recently-used
  cache.delete(k)
  cache.set(k, entry)
  return entry
}

export function setCachedJwt(entry: Sep10Auth): void {
  const k = key(entry.anchorDomain, entry.publicKey)
  if (cache.has(k)) cache.delete(k)
  cache.set(k, entry)
  evictIfOverCapacity()
}

export function invalidateCachedJwt(anchorDomain: string, publicKey: string): void {
  cache.delete(key(anchorDomain, publicKey))
}

export function clearJwtCache(): void {
  cache.clear()
}

export function setJwtCacheCapacity(n: number): void {
  capacity = Math.max(1, n)
  evictIfOverCapacity()
}
