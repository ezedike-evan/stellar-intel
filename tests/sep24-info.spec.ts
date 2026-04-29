import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSep24Info, _clearInfoCache } from '@/lib/stellar/sep24'

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24'
const TRANSFER_SERVER_B = 'https://anclap.com/sep24'

const MOCK_INFO: ReturnType<typeof buildMockInfo> = buildMockInfo()

function buildMockInfo() {
  return {
    deposit: { USDC: { enabled: true, min_amount: 1, max_amount: 10000 } },
    withdraw: { USDC: { enabled: true, min_amount: 1, max_amount: 10000 } },
    fee: { enabled: true },
    transaction: { enabled: true, authentication_required: true },
    transactions: { enabled: true, authentication_required: true },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  _clearInfoCache()
})

// ─── getSep24Info ─────────────────────────────────────────────────────────────

describe('getSep24Info', () => {
  it('returns parsed info for a known anchor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => MOCK_INFO,
    })))

    const result = await getSep24Info(TRANSFER_SERVER)
    expect(result.withdraw['USDC']?.enabled).toBe(true)
    expect(result.fee.enabled).toBe(true)
  })

  it('fetches /info at the correct URL', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url
      return { ok: true, json: async () => MOCK_INFO }
    }))

    await getSep24Info(TRANSFER_SERVER)
    expect(capturedUrl).toBe(`${TRANSFER_SERVER}/info`)
  })

  it('returns cached data on repeated calls without re-fetching', async () => {
    let fetchCount = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCount++
      return { ok: true, json: async () => MOCK_INFO }
    }))

    await getSep24Info(TRANSFER_SERVER)
    await getSep24Info(TRANSFER_SERVER)
    await getSep24Info(TRANSFER_SERVER)

    expect(fetchCount).toBe(1)
  })

  it('re-fetches after cache is explicitly cleared', async () => {
    let fetchCount = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCount++
      return { ok: true, json: async () => MOCK_INFO }
    }))

    await getSep24Info(TRANSFER_SERVER)
    _clearInfoCache()
    await getSep24Info(TRANSFER_SERVER)

    expect(fetchCount).toBe(2)
  })

  it('maintains separate cache entries per transfer server', async () => {
    let fetchCount = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCount++
      return { ok: true, json: async () => MOCK_INFO }
    }))

    await getSep24Info(TRANSFER_SERVER)
    await getSep24Info(TRANSFER_SERVER_B)
    await getSep24Info(TRANSFER_SERVER)   // cache hit for first

    expect(fetchCount).toBe(2)
  })

  it('expires cache after 5 minutes', async () => {
    vi.useFakeTimers()
    let fetchCount = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCount++
      return { ok: true, json: async () => MOCK_INFO }
    }))

    await getSep24Info(TRANSFER_SERVER)
    vi.advanceTimersByTime(5 * 60 * 1_000 + 1)
    await getSep24Info(TRANSFER_SERVER)

    expect(fetchCount).toBe(2)
    vi.useRealTimers()
  })

  it('throws on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    await expect(getSep24Info(TRANSFER_SERVER)).rejects.toThrow(/HTTP 500/)
  })
})
