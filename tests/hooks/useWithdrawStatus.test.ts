import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { SWRConfig } from 'swr'
import { useWithdrawStatus } from '@/hooks/useWithdrawStatus'

const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children)

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24'
const TXN_ID = 'txn-abc123'
const JWT = 'test-jwt'

function mockFetch(status: string) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      transaction: {
        id: TXN_ID,
        status,
        amount_in: '100',
        amount_out: '97.5',
        amount_fee: '2.5',
      },
    }),
  })))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useWithdrawStatus', () => {
  it('polling is enabled (SWR key is non-null) when all three parameters are provided', async () => {
    mockFetch('pending_external')
    const { result } = renderHook(
      () => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT),
      { wrapper }
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.status).toBe('pending_external')
  })

  it('polling is disabled (SWR key is null) when transactionId is null', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, null, JWT), { wrapper })
    // fetch should never be called
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('raw status string "pending_external" is correctly mapped and returned', async () => {
    mockFetch('pending_external')
    const { result } = renderHook(
      () => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status).toBe('pending_external'))
  })

  it('returns completed status correctly', async () => {
    mockFetch('completed')
    const { result } = renderHook(
      () => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status).toBe('completed'))
  })

  it('returns error status correctly', async () => {
    mockFetch('error')
    const { result } = renderHook(
      () => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status).toBe('error'))
  })
})
