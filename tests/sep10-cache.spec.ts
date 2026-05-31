import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Networks } from '@stellar/stellar-sdk'
import { authenticate, invalidateSep10Token } from '@/lib/stellar/sep10'
import { clearJwtCache, setJwtCacheCapacity, getCachedJwt } from '@/lib/stellar/jwt-cache'
import * as sep1 from '@/lib/stellar/sep1'

const WEB_AUTH_ENDPOINT = 'https://cowrie.exchange/auth'
const ANCHOR = 'cowrie.exchange'
const PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789'
const CHALLENGE_XDR = 'AAAAAQAAAAC...'
const SIGNED_XDR = 'AAAAAQAAAAD...'

const mockResolvedAnchor = (domain: string) => ({
  id: domain.split('.')[0] || 'anchor',
  name: domain,
  homeDomain: domain,
  corridors: [],
  assetCode: 'USDC',
  assetIssuer: 'G...',
  TRANSFER_SERVER_SEP0024: `https://${domain}/sep24`,
  WEB_AUTH_ENDPOINT: `https://${domain}/auth`,
  SIGNING_KEY: 'G...',
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
})

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
}))

function makeJwt(expSeconds: number): string {
  const b64url = (s: string) =>
    btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ exp: expSeconds }))
  return `${header}.${payload}.signature`
}

async function getFreighter() {
  return await import('@stellar/freighter-api')
}

function stubChallengeAndJwt(jwt: string) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transaction: CHALLENGE_XDR, network_passphrase: Networks.PUBLIC }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: jwt }),
    })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(async () => {
  vi.restoreAllMocks()
  clearJwtCache()
  setJwtCacheCapacity(32)

  const freighter = await getFreighter()
  vi.mocked(freighter.signTransaction).mockResolvedValue({
    signedTxXdr: SIGNED_XDR,
    signerAddress: PUBLIC_KEY,
  })
})

describe('SEP-10 JWT cache', () => {
  it('second call within validity returns cached token without invoking Freighter', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    stubChallengeAndJwt(makeJwt(exp))

    const first = await authenticate(mockResolvedAnchor(ANCHOR), PUBLIC_KEY)

    const freighter = await getFreighter()
    vi.mocked(freighter.signTransaction).mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch should not be called on cache hit')
    }))

    const second = await authenticate(mockResolvedAnchor(ANCHOR), PUBLIC_KEY)

    expect(second.jwt).toBe(first.jwt)
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime())
    expect(freighter.signTransaction).not.toHaveBeenCalled()
  })

  it('expired cached token triggers a fresh sign flow', async () => {
    const shortExp = Math.floor(Date.now() / 1000) + 1
    stubChallengeAndJwt(makeJwt(shortExp))

    await authenticate(mockResolvedAnchor(ANCHOR), PUBLIC_KEY)

    // Advance past expiry
    vi.useFakeTimers()
    vi.setSystemTime(new Date((shortExp + 5) * 1000))

    const freighter = await getFreighter()
    vi.mocked(freighter.signTransaction).mockClear()

    const newExp = Math.floor(Date.now() / 1000) + 3600
    stubChallengeAndJwt(makeJwt(newExp))

    const fresh = await authenticate(mockResolvedAnchor(ANCHOR), PUBLIC_KEY)

    expect(freighter.signTransaction).toHaveBeenCalledTimes(1)
    expect(fresh.expiresAt.getTime()).toBe(newExp * 1000)

    vi.useRealTimers()
  })

  it('invalidateSep10Token forces re-authentication on next call', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    stubChallengeAndJwt(makeJwt(exp))

    await authenticate(mockResolvedAnchor(ANCHOR), PUBLIC_KEY)
    expect(getCachedJwt(ANCHOR, PUBLIC_KEY)).toBeDefined()

    // Simulate downstream 401 response → invalidate
    invalidateSep10Token(ANCHOR, PUBLIC_KEY)
    expect(getCachedJwt(ANCHOR, PUBLIC_KEY)).toBeUndefined()

    const freighter = await getFreighter()
    vi.mocked(freighter.signTransaction).mockClear()
    stubChallengeAndJwt(makeJwt(exp))

    await authenticate(mockResolvedAnchor(ANCHOR), PUBLIC_KEY)
    expect(freighter.signTransaction).toHaveBeenCalledTimes(1)
  })

  it('LRU evicts the least-recently-used entry past capacity', async () => {
    setJwtCacheCapacity(2)
    const exp = Math.floor(Date.now() / 1000) + 3600

    stubChallengeAndJwt(makeJwt(exp))
    await authenticate(mockResolvedAnchor('a.example'), PUBLIC_KEY)

    stubChallengeAndJwt(makeJwt(exp))
    await authenticate(mockResolvedAnchor('b.example'), PUBLIC_KEY)

    // Touch 'a' so 'b' becomes the LRU
    expect(getCachedJwt('a.example', PUBLIC_KEY)).toBeDefined()

    stubChallengeAndJwt(makeJwt(exp))
    await authenticate(mockResolvedAnchor('c.example'), PUBLIC_KEY)

    expect(getCachedJwt('a.example', PUBLIC_KEY)).toBeDefined()
    expect(getCachedJwt('c.example', PUBLIC_KEY)).toBeDefined()
    expect(getCachedJwt('b.example', PUBLIC_KEY)).toBeUndefined()
  })
})
