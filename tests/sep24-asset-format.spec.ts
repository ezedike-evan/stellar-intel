import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveAssetParams, getSep24Fee, fetchAnchorFee, initiateWithdraw, _clearInfoCache } from '@/lib/stellar/sep24'
import * as sep1 from '@/lib/stellar/sep1'

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24'

function buildMockInfo(newStyle: boolean) {
  if (newStyle) {
    return {
      deposit: { 'stellar:USDC:GA5Z...': { enabled: true } },
      withdraw: { 'stellar:USDC:GA5Z...': { enabled: true } },
      fee: { enabled: true },
      transaction: { enabled: true },
      transactions: { enabled: true },
    }
  }
  return {
    deposit: { USDC: { enabled: true } },
    withdraw: { USDC: { enabled: true } },
    fee: { enabled: true },
    transaction: { enabled: true },
    transactions: { enabled: true },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  _clearInfoCache()
  process.env.TEST_SEP24_INFO = '1'
})

describe('resolveAssetParams', () => {
  it('returns old style params if info does not use SEP-38 format', () => {
    const info = buildMockInfo(false)
    const params = resolveAssetParams(info as any, 'withdraw', 'USDC', 'GA5Z...')
    expect(params).toEqual({ asset_code: 'USDC', asset_issuer: 'GA5Z...' })
  })

  it('returns new style param if info uses SEP-38 format', () => {
    const info = buildMockInfo(true)
    const params = resolveAssetParams(info as any, 'withdraw', 'USDC', 'GA5Z...')
    expect(params).toEqual({ asset: 'stellar:USDC:GA5Z...' })
  })

  it('handles XLM properly', () => {
    const info = {
      deposit: { 'stellar:native': { enabled: true } },
      withdraw: { 'stellar:native': { enabled: true } },
    }
    const params = resolveAssetParams(info as any, 'withdraw', 'XLM', undefined)
    expect(params).toEqual({ asset: 'stellar:native' })
  })
})

describe('getSep24Fee asset formats', () => {
  it('encodes correctly for old style anchor', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/info')) return { ok: true, json: async () => buildMockInfo(false) }
      capturedUrl = url
      return { ok: true, json: async () => ({ fee: 5 }) }
    }))

    await getSep24Fee({
      transferServer: TRANSFER_SERVER,
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      amount: '100',
      type: 'bank_account',
    })

    const parsedUrl = new URL(capturedUrl)
    expect(parsedUrl.searchParams.get('asset_code')).toBe('USDC')
    expect(parsedUrl.searchParams.get('asset_issuer')).toBe('GA5Z...')
    expect(parsedUrl.searchParams.has('asset')).toBe(false)
  })

  it('encodes correctly for new style anchor', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/info')) return { ok: true, json: async () => buildMockInfo(true) }
      capturedUrl = url
      return { ok: true, json: async () => ({ fee: 5 }) }
    }))

    await getSep24Fee({
      transferServer: TRANSFER_SERVER,
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      amount: '100',
      type: 'bank_account',
    })

    const parsedUrl = new URL(capturedUrl)
    expect(parsedUrl.searchParams.get('asset')).toBe('stellar:USDC:GA5Z...')
    expect(parsedUrl.searchParams.has('asset_code')).toBe(false)
  })
})

describe('initiateWithdraw asset formats', () => {
  it('sends correct body for old style anchor', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (url.endsWith('/info')) return { ok: true, json: async () => buildMockInfo(false) }
      capturedBody = init?.body
      return { ok: true, json: async () => ({ type: 'interactive_customer_info_needed', url: 'test', id: '123' }) }
    }))

    await initiateWithdraw({
      transferServer: TRANSFER_SERVER,
      jwt: 'abc',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      amount: '100',
      account: 'GABC',
    })

    const body = JSON.parse(capturedBody)
    expect(body.asset_code).toBe('USDC')
    expect(body.asset_issuer).toBe('GA5Z...')
    expect(body.asset).toBeUndefined()
  })

  it('sends correct body for new style anchor', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (url.endsWith('/info')) return { ok: true, json: async () => buildMockInfo(true) }
      capturedBody = init?.body
      return { ok: true, json: async () => ({ type: 'interactive_customer_info_needed', url: 'test', id: '123' }) }
    }))

    await initiateWithdraw({
      transferServer: TRANSFER_SERVER,
      jwt: 'abc',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      amount: '100',
      account: 'GABC',
    })

    const body = JSON.parse(capturedBody)
    expect(body.asset).toBe('stellar:USDC:GA5Z...')
    expect(body.asset_code).toBeUndefined()
  })
})
