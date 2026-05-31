import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSep24Transaction, TERMINAL_STATES } from '@/lib/stellar/sep24'

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24'
const TRANSACTION_ID = 'txn-abc123'
const JWT = 'test-jwt'

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─── getSep24Transaction ──────────────────────────────────────────────────────

describe('getSep24Transaction', () => {
  it('fetches the correct endpoint with Authorization header', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}

    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: RequestInit) => {
      capturedUrl = url
      capturedHeaders = opts.headers as Record<string, string>
      return {
        ok: true,
        json: async () => ({
          transaction: { id: TRANSACTION_ID, status: 'pending_external' },
        }),
      }
    }))

    await getSep24Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)

    expect(capturedUrl).toBe(`${TRANSFER_SERVER}/transaction?id=${TRANSACTION_ID}`)
    expect(capturedHeaders['Authorization']).toBe(`Bearer ${JWT}`)
  })

  it('returns a WithdrawStatus with all mapped fields on a well-formed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        transaction: {
          id: TRANSACTION_ID,
          status: 'completed',
          amount_in: '100.00',
          amount_out: '155000.00',
          amount_fee: '2.00',
          stellar_transaction_id: 'stellar-hash-xyz',
        },
      }),
    })))

    const result = await getSep24Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)

    expect(result.id).toBe(TRANSACTION_ID)
    expect(result.status).toBe('completed')
    expect(result.amountIn).toBe('100.00')
    expect(result.amountOut).toBe('155000.00')
    expect(result.amountFee).toBe('2.00')
    expect(result.stellarTransactionId).toBe('stellar-hash-xyz')
    expect(result.updatedAt).toBeInstanceOf(Date)
  })

  it('maps a known status string correctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ transaction: { id: TRANSACTION_ID, status: 'pending_anchor' } }),
    })))

    const result = await getSep24Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)
    expect(result.status).toBe('pending_anchor')
  })

  it('defaults an unknown anchor status to "pending_external" without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ transaction: { id: TRANSACTION_ID, status: 'some_custom_anchor_state' } }),
    })))

    const result = await getSep24Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)
    expect(result.status).toBe('pending_external')
  })

  it('defaults a missing status to "pending_external"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ transaction: { id: TRANSACTION_ID } }),
    })))

    const result = await getSep24Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)
    expect(result.status).toBe('pending_external')
  })

  it('uses the transactionId as fallback when id is absent from the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ transaction: { status: 'pending_external' } }),
    })))

    const result = await getSep24Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)
    expect(result.id).toBe(TRANSACTION_ID)
  })

  it('throws a descriptive error on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))

    await expect(
      getSep24Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)
    ).rejects.toThrow(/HTTP 404/)
  })

  it('throws on a 401 Unauthorized response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))

    await expect(
      getSep24Transaction(TRANSFER_SERVER, TRANSACTION_ID, JWT)
    ).rejects.toThrow(/HTTP 401/)
  })
})

// ─── TERMINAL_STATES ──────────────────────────────────────────────────────────

describe('TERMINAL_STATES', () => {
  it('includes completed, error, and refunded', () => {
    expect(TERMINAL_STATES.has('completed')).toBe(true)
    expect(TERMINAL_STATES.has('error')).toBe(true)
    expect(TERMINAL_STATES.has('refunded')).toBe(true)
  })

  it('does not include non-terminal statuses', () => {
    expect(TERMINAL_STATES.has('pending_external')).toBe(false)
    expect(TERMINAL_STATES.has('pending_anchor')).toBe(false)
    expect(TERMINAL_STATES.has('incomplete')).toBe(false)
  })
})
