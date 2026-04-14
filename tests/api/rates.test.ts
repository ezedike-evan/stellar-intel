import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/rates/route'
import * as sep24 from '@/lib/stellar/sep24'
import * as estimatedRates from '@/lib/stellar/estimatedRates'
import type { AnchorRate } from '@/types'

const makeRate = (anchorId: string, total: number): AnchorRate => ({
  anchorId,
  anchorName: anchorId,
  corridorId: 'usdc-ngn',
  fee: 2,
  feeType: 'flat',
  exchangeRate: 1580,
  totalReceived: total,
  updatedAt: new Date(),
})

const mockResults = (rates: AnchorRate[]): PromiseSettledResult<AnchorRate>[] =>
  rates.map((r) => ({ status: 'fulfilled', value: r }))

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/rates')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue(
    mockResults([makeRate('cowrie', 97_000), makeRate('flutterwave', 98_000)])
  )
})

describe('GET /api/rates', () => {
  it('returns 200 with correct response shape for a valid corridor', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ngn', amount: '100' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rates).toBeDefined()
    expect(body.fetchedAt).toBeDefined()
    expect(body.rates.bestRateId).toBe('flutterwave')
  })

  it('returns 400 when corridor is absent', async () => {
    const res = await GET(makeRequest({ amount: '100' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('MISSING_CORRIDOR')
  })

  it('returns 400 for an invalid corridor', async () => {
    const res = await GET(makeRequest({ corridor: 'invalid', amount: '100' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_CORRIDOR')
  })

  it('defaults amount to 100 and returns 200 when amount is absent', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ngn' }))
    expect(res.status).toBe(200)
  })

  it('returns 400 for a negative amount', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ngn', amount: '-50' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_AMOUNT')
  })

  it('returns 500 when all anchor fetches fail and estimated rates also fail', async () => {
    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue([
      { status: 'rejected', reason: new Error('timeout') },
    ])
    vi.spyOn(estimatedRates, 'fetchEstimatedRates').mockRejectedValue(
      new Error('Exchange rate API unavailable')
    )
    const res = await GET(makeRequest({ corridor: 'usdc-ngn', amount: '100' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('ALL_ANCHORS_FAILED')
  })

  it('falls back to estimated rates and returns 200 when anchor APIs fail', async () => {
    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue([
      { status: 'rejected', reason: new Error('timeout') },
    ])
    vi.spyOn(estimatedRates, 'fetchEstimatedRates').mockResolvedValue([
      { ...makeRate('cowrie', 133000), source: 'estimated' },
    ])
    const res = await GET(makeRequest({ corridor: 'usdc-ngn', amount: '100' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rates.rates[0].source).toBe('estimated')
  })

  it('sets Cache-Control: no-store on successful responses', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ngn', amount: '100' }))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
