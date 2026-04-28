
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveToml, _clearTomlCache } from '@/lib/stellar/sep1'
import type { TomlResult } from '@/lib/stellar/sep1'

// ─── Shared TOML fixture ───────────────────────────────────────────────────────

const GOOD_TOML = {
  TRANSFER_SERVER_SEP0024: 'https://anchor.example.com/sep24',
  WEB_AUTH_ENDPOINT: 'https://anchor.example.com/auth',
  SIGNING_KEY: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  CURRENCIES: [{ code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' }],
}

// ─── Module mock ──────────────────────────────────────────────────────────────
vi.mock('@stellar/stellar-sdk', () => ({
  StellarToml: {
    Resolver: {
      resolve: vi.fn(),
    },
  },
}))

// Mock the anchors list so resolveAllAnchors doesn't need real data in other tests.
vi.mock('@/lib/stellar/anchors', () => ({
  ANCHORS: [],
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getMockedResolve() {
  const { StellarToml } = await import('@stellar/stellar-sdk')
  return StellarToml.Resolver.resolve as ReturnType<typeof vi.fn>
}

/** Fast-forward fake timers by `ms` and flush the micro-task queue. */
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('resolveToml — retry & typed result', () => {
  beforeEach(() => {
    _clearTomlCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // ── 1. Happy path ──────────────────────────────────────────────────────────

  it('returns { ok: true, data } when the server responds immediately', async () => {
    const mockResolve = await getMockedResolve()
    mockResolve.mockResolvedValueOnce(GOOD_TOML)

    const promise = resolveToml('anchor.example.com')
    await tick(0) // let the promise resolve
    const result: TomlResult = await promise

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('type guard')

    expect(result.data.TRANSFER_SERVER_SEP0024).toBe(GOOD_TOML.TRANSFER_SERVER_SEP0024)
    expect(result.data.WEB_AUTH_ENDPOINT).toBe(GOOD_TOML.WEB_AUTH_ENDPOINT)
    expect(result.data.SIGNING_KEY).toBe(GOOD_TOML.SIGNING_KEY)
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })

  // ── 2. Flaky server (AC: resolves on retry 2) ─────────────────────────────

  it('resolves on the 3rd attempt when the first two fail', async () => {
    const mockResolve = await getMockedResolve()
    const networkError = new Error('ECONNRESET')

    // Attempt 0 → fail, Attempt 1 → fail, Attempt 2 → succeed
    mockResolve
      .mockRejectedValueOnce(networkError)   // attempt 0
      .mockRejectedValueOnce(networkError)   // attempt 1 (retry 1)
      .mockResolvedValueOnce(GOOD_TOML)      // attempt 2 (retry 2) ← resolves here

    const promise = resolveToml('flaky.anchor.io')


    await tick(250)   
    await tick(500)   

    const result = await promise

    expect(result.ok).toBe(true)
    expect(mockResolve).toHaveBeenCalledTimes(3)
  })

  // ── 3. Permanent failure — never throws, returns typed error ──────────────

  it('returns { ok: false, error } after all retries without throwing', async () => {
    const mockResolve = await getMockedResolve()
    mockResolve.mockRejectedValue(new Error('503 Service Unavailable'))

    const promise = resolveToml('down.anchor.io')

   
    await tick(250)   
    await tick(500)   
    

    const result = await promise

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('type guard')

    expect(result.error).toMatch(/503 Service Unavailable/)
    
    expect(mockResolve).toHaveBeenCalledTimes(3)
  })

  it('result is a plain value — the promise itself never rejects', async () => {
    const mockResolve = await getMockedResolve()
    mockResolve.mockRejectedValue(new Error('always fails'))

    const promise = resolveToml('always-down.anchor.io')
    await tick(250)
    await tick(500)
    await expect(promise).resolves.toMatchObject({ ok: false })
  })

  // ── 4. Missing required field → typed error, not exception ────────────────

  it('returns { ok: false } when TRANSFER_SERVER_SEP0024 is absent', async () => {
    const mockResolve = await getMockedResolve()
    mockResolve.mockResolvedValueOnce({
      WEB_AUTH_ENDPOINT: 'https://anchor.example.com/auth',
    })

    const promise = resolveToml('partial.anchor.io')
    await tick(0)
    const result = await promise

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('type guard')
    expect(result.error).toMatch(/TRANSFER_SERVER_SEP0024/)
    // Only one attempt — the field-validation error is not retried
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })

  it('returns { ok: false } when WEB_AUTH_ENDPOINT is absent', async () => {
    const mockResolve = await getMockedResolve()
    mockResolve.mockResolvedValueOnce({
      TRANSFER_SERVER_SEP0024: 'https://anchor.example.com/sep24',
      // intentionally omit WEB_AUTH_ENDPOINT
    })

    const promise = resolveToml('noauth.anchor.io')
    await tick(0)
    const result = await promise

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('type guard')
    expect(result.error).toMatch(/WEB_AUTH_ENDPOINT/)
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })

  // ── 5. Cache — second call uses cache, no extra network hit ───────────────

  it('returns cached data on the second call without calling the network again', async () => {
    const mockResolve = await getMockedResolve()
    mockResolve.mockResolvedValue(GOOD_TOML)

    const promise1 = resolveToml('cached.anchor.io')
    await tick(0)
    const result1 = await promise1

    const promise2 = resolveToml('cached.anchor.io')
    await tick(0)
    const result2 = await promise2

    expect(result1.ok).toBe(true)
    expect(result2.ok).toBe(true)
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })

  // ── 6. Budget guard — stops retrying when wall-clock would exceed 5 s ─────

  it('stops retrying early if the budget would be exceeded by the next delay', async () => {
    const mockResolve = await getMockedResolve()

    let callCount = 0
    mockResolve.mockImplementation(() => {
      callCount++
      if (callCount <= 2) {
        // Burn 4.6 s of wall-clock on attempt 2
        return new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), callCount === 2 ? 4600 : 0)
        )
      }
      return Promise.resolve(GOOD_TOML)
    })

    const promise = resolveToml('slow.anchor.io')

    await tick(250)
    await tick(4600)

    const result = await promise

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('type guard')
    // Should have stopped at attempt 1 or 2 — never reached the good mock
    expect(callCount).toBeLessThan(3)
  })
})