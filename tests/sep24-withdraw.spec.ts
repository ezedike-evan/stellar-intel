import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initiateWithdraw, Sep24WithdrawError } from '@/lib/stellar/sep24'

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24'

const PARAMS = {
  transferServer: TRANSFER_SERVER,
  jwt: 'test-jwt',
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  amount: '100',
  account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─── initiateWithdraw ─────────────────────────────────────────────────────────

describe('initiateWithdraw — POST /transactions/withdraw/interactive', () => {
  it('returns typed { id, url, type } on a valid anchor response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        type: 'interactive_customer_info_needed',
        url: 'https://anchor.io/kyc/session-abc',
        id: 'txn-xyz',
      }),
    })))

    const result = await initiateWithdraw(PARAMS)
    expect(result.id).toBe('txn-xyz')
    expect(result.url).toBe('https://anchor.io/kyc/session-abc')
    expect(result.type).toBe('interactive_customer_info_needed')
  })

  it('sends correct POST body: asset_code, asset_issuer, amount, account', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => {
      body = JSON.parse(opts.body as string) as Record<string, unknown>
      return {
        ok: true,
        json: async () => ({
          type: 'interactive_customer_info_needed',
          url: 'https://u',
          id: 'id1',
        }),
      }
    }))

    await initiateWithdraw(PARAMS)
    expect(body['asset_code']).toBe('USDC')
    expect(body['asset_issuer']).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
    expect(body['amount']).toBe('100')
    expect(body['account']).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })

  it('sends Authorization: Bearer <jwt> header', async () => {
    let headers: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => {
      headers = opts.headers as Record<string, string>
      return {
        ok: true,
        json: async () => ({
          type: 'interactive_customer_info_needed',
          url: 'https://u',
          id: 'id1',
        }),
      }
    }))

    await initiateWithdraw(PARAMS)
    expect(headers['Authorization']).toBe('Bearer test-jwt')
  })

  it('throws Sep24WithdrawError on non-200, preserving status code and anchor body', async () => {
    const anchorBody = { error: 'unsupported asset' }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => anchorBody,
    })))

    const caught = await initiateWithdraw(PARAMS).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(Sep24WithdrawError)
    const err = caught as Sep24WithdrawError
    expect(err.status).toBe(422)
    expect(err.anchorBody).toEqual(anchorBody)
  })

  it('Sep24WithdrawError message includes the HTTP status code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
    })))

    await expect(initiateWithdraw(PARAMS)).rejects.toThrow(/403/)
  })

  it('throws when response type is not interactive_customer_info_needed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: 'error', error: 'not supported' }),
    })))

    await expect(initiateWithdraw(PARAMS)).rejects.toThrow(/Unexpected response type/)
  })

  it('throws when url field is absent from the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: 'interactive_customer_info_needed', id: 'txn-1' }),
    })))

    await expect(initiateWithdraw(PARAMS)).rejects.toThrow(/"url"/)
  })
})
