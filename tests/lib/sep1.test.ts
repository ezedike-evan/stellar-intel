import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Networks, StellarToml } from '@stellar/stellar-sdk'
import {
  resolveAnchor,
  resolveToml,
  getTransferServer,
  getWebAuthEndpoint,
  resolveAllAnchors,
  _clearTomlCache,
} from '@/lib/stellar/sep1'

const VALID_TOML = {
  TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
  ANCHOR_QUOTE_SERVER: 'https://cowrie.exchange/quotes',
  WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
  SIGNING_KEY: 'GABCDEF',
  NETWORK_PASSPHRASE: Networks.PUBLIC,
  CURRENCIES: [
    { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
  ],
}

beforeEach(() => {
  _clearTomlCache()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveAnchor', () => {
  it('calls StellarToml.Resolver.resolve and extracts SEP-1 fields', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    const result = await resolveAnchor('cowrie.exchange')

    expect(spy).toHaveBeenCalledWith('cowrie.exchange')
    expect(result).toEqual({
      domain: 'cowrie.exchange',
      TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
      ANCHOR_QUOTE_SERVER: 'https://cowrie.exchange/quotes',
      WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
      SIGNING_KEY: 'GABCDEF',
      NETWORK_PASSPHRASE: Networks.PUBLIC,
      CURRENCIES: [
        { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
      ],
    })
  })

  it('normalizes domain casing for cache keys', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    await resolveAnchor(' Cowrie.Exchange ')
    await resolveAnchor('cowrie.exchange')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('cowrie.exchange')
  })

  it('returns nullable fields when optional TOML values are absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({} as never)

    const result = await resolveAnchor('cowrie.exchange')

    expect(result.TRANSFER_SERVER_SEP0024).toBeNull()
    expect(result.ANCHOR_QUOTE_SERVER).toBeNull()
    expect(result.WEB_AUTH_ENDPOINT).toBeNull()
    expect(result.SIGNING_KEY).toBeNull()
    expect(result.NETWORK_PASSPHRASE).toBeNull()
    expect(result.CURRENCIES).toEqual([])
  })

  it('throws a descriptive error when the network call fails', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockRejectedValue(new Error('Network timeout'))

    await expect(resolveAnchor('cowrie.exchange')).rejects.toThrow(
      /Failed to resolve stellar\.toml for "cowrie\.exchange"/
    )
  })

  it('returns a cache hit in under 1ms', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    await resolveAnchor('cowrie.exchange')

    const startedAt = performance.now()
    const cached = await resolveAnchor('cowrie.exchange')
    const elapsedMs = performance.now() - startedAt

    expect(cached.WEB_AUTH_ENDPOINT).toBe('https://cowrie.exchange/auth')
    expect(elapsedMs).toBeLessThan(1)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refreshes the cached TOML after the 15-minute TTL expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const spy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValueOnce(VALID_TOML as never)
      .mockResolvedValueOnce({
        ...VALID_TOML,
        WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/new-auth',
      } as never)

    await resolveAnchor('cowrie.exchange')
    vi.setSystemTime(new Date('2026-01-01T00:15:00.001Z'))

    const refreshed = await resolveAnchor('cowrie.exchange')

    expect(refreshed.WEB_AUTH_ENDPOINT).toBe('https://cowrie.exchange/new-auth')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('resolveToml', () => {
  it('keeps the old resolver name as an alias for resolveAnchor', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    const result = await resolveToml('cowrie.exchange')

    expect(result.ANCHOR_QUOTE_SERVER).toBe('https://cowrie.exchange/quotes')
  })
})

describe('getTransferServer', () => {
  it('returns the transfer server URL', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    const url = await getTransferServer('cowrie.exchange')
    expect(url).toBe('https://cowrie.exchange/sep24')
  })

  it('throws when TRANSFER_SERVER_SEP0024 is absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
    } as never)

    await expect(getTransferServer('cowrie.exchange')).rejects.toThrow(
      /Missing TRANSFER_SERVER_SEP0024.*"cowrie\.exchange"/
    )
  })
})

describe('getWebAuthEndpoint', () => {
  it('returns the web auth endpoint URL', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    const url = await getWebAuthEndpoint('cowrie.exchange')
    expect(url).toBe('https://cowrie.exchange/auth')
  })

  it('throws when WEB_AUTH_ENDPOINT is absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
    } as never)

    await expect(getWebAuthEndpoint('cowrie.exchange')).rejects.toThrow(
      /Missing WEB_AUTH_ENDPOINT.*"cowrie\.exchange"/
    )
  })
})

describe('resolveAllAnchors', () => {
  it('calls resolve for each anchor in ANCHORS', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    await resolveAllAnchors()

    // ANCHORS has 4 entries: moneygram, cowrie, flutterwave, anclap
    expect(spy).toHaveBeenCalledTimes(4)
  })

  it('returns partial results when one anchor fails', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockImplementation((domain) => {
      if (domain === 'anclap.com') return Promise.reject(new Error('timeout'))
      return Promise.resolve(VALID_TOML as never)
    })

    const result = await resolveAllAnchors()
    expect(result['moneygram']).toBeDefined()
    expect(result['cowrie']).toBeDefined()
    expect(result['anclap']).toBeUndefined()
  })
})
