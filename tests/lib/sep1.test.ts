import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StellarToml } from '@stellar/stellar-sdk'
import {
  resolveToml,
  getTransferServer,
  getWebAuthEndpoint,
  resolveAllAnchors,
  _clearTomlCache,
} from '@/lib/stellar/sep1'

const VALID_TOML = {
  TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
  WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
  SIGNING_KEY: 'GABCDEF',
  CURRENCIES: [
    { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
  ],
}

beforeEach(() => {
  _clearTomlCache()
  vi.restoreAllMocks()
})

describe('resolveToml', () => {
  it('returns the correct TRANSFER_SERVER_SEP0024', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    const result = await resolveToml('cowrie.exchange')
    expect(result.TRANSFER_SERVER_SEP0024).toBe('https://cowrie.exchange/sep24')
  })

  it('returns the correct WEB_AUTH_ENDPOINT', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    const result = await resolveToml('cowrie.exchange')
    expect(result.WEB_AUTH_ENDPOINT).toBe('https://cowrie.exchange/auth')
  })

  it('returns sep24 false when TRANSFER_SERVER_SEP0024 is absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
    } as never)

    const result = await resolveToml('cowrie.exchange')

    expect(result.capabilities.sep24).toBe(false)
    expect(result.capabilities.sep10).toBe(true)
    expect(result.TRANSFER_SERVER_SEP0024).toBeUndefined()
  })

  it('returns sep10 false when WEB_AUTH_ENDPOINT is absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
    } as never)

    const result = await resolveToml('cowrie.exchange')

    expect(result.capabilities.sep10).toBe(false)
    expect(result.capabilities.sep24).toBe(true)
    expect(result.WEB_AUTH_ENDPOINT).toBeUndefined()
  })

  it('throws a descriptive error when the network call fails', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockRejectedValue(new Error('Network timeout'))

    await expect(resolveToml('cowrie.exchange')).rejects.toThrow(
      /Failed to resolve stellar\.toml for "cowrie\.exchange"/
    )
  })

  it('returns the cached result on a second call without re-fetching', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    await resolveToml('cowrie.exchange')
    await resolveToml('cowrie.exchange')

    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('getTransferServer', () => {
  it('returns the transfer server URL', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    const url = await getTransferServer('cowrie.exchange')
    expect(url).toBe('https://cowrie.exchange/sep24')
  })
})

describe('getWebAuthEndpoint', () => {
  it('returns the web auth endpoint URL', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never)

    const url = await getWebAuthEndpoint('cowrie.exchange')
    expect(url).toBe('https://cowrie.exchange/auth')
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
