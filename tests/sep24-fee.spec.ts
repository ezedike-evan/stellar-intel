import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSep24Fee } from '@/lib/stellar/sep24'

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24'

const BASE_PARAMS = {
  transferServer: TRANSFER_SERVER,
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  amount: '100',
  type: 'bank_account',
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─── getSep24Fee ──────────────────────────────────────────────────────────────

describe('getSep24Fee', () => {
  it('returns { ok: true, fee } on a valid anchor response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ fee: 2 }),
    })))

    const result = await getSep24Fee(BASE_PARAMS)
    expect(result).toEqual({ ok: true, fee: 2 })
  })

  it('builds the correct URL with all required query parameters', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url
      return { ok: true, status: 200, json: async () => ({ fee: 1 }) }
    }))

    await getSep24Fee({ ...BASE_PARAMS, amount: '50', type: 'bank_account' })

    expect(capturedUrl).toContain('operation=withdraw')
    expect(capturedUrl).toContain('asset_code=USDC')
    expect(capturedUrl).toContain('amount=50')
    expect(capturedUrl).toContain('type=bank_account')
  })

  it('returns { ok: false, reason: "unsupported" } on 404 without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
    })))

    const result = await getSep24Fee(BASE_PARAMS)
    expect(result).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('retries once on network failure and succeeds on second attempt', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('network error')
      return { ok: true, status: 200, json: async () => ({ fee: 3 }) }
    }))

    const result = await getSep24Fee(BASE_PARAMS)
    expect(calls).toBe(2)
    expect(result).toEqual({ ok: true, fee: 3 })
  })

  it('throws after two consecutive network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network error')
    }))

    await expect(getSep24Fee(BASE_PARAMS)).rejects.toThrow('network error')
  })

  it('aborts after 5 seconds and retries a second time', async () => {
    vi.useFakeTimers()
    let calls = 0

    vi.stubGlobal('fetch', vi.fn((_url: string, opts: { signal: AbortSignal }) => {
      calls++
      return new Promise<Response>((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          ;(err as NodeJS.ErrnoException).name = 'AbortError'
          reject(err)
        })
      })
    }))

    const promise = getSep24Fee(BASE_PARAMS)
    // Run timers and catch rejection concurrently so neither is unhandled
    await Promise.all([
      vi.runAllTimersAsync(),
      expect(promise).rejects.toBeDefined(),
    ])
    expect(calls).toBe(2)

    vi.useRealTimers()
  })

  it('returns { ok: false, reason: "unsupported" } when fee field is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ some_other_field: 'oops' }),
    })))

    const result = await getSep24Fee(BASE_PARAMS)
    expect(result).toEqual({ ok: false, reason: 'unsupported' })
  })
})
