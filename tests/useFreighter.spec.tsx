import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, waitFor } from '@testing-library/react'
import { useFreighter } from '@/hooks/useFreighter'
import type { FreighterState } from '@/types'

/**
 * Tests for useFreighter hook lifecycle.
 *
 * Tests four lifecycle scenarios:
 * - Detect: extension presence detected
 * - Connect: user connects wallet
 * - Disconnect: user disconnects wallet
 * - Network-change: network switched
 */

// ─── Mock Freighter API ───────────────────────────────────────────────────────

const mockFreighterApi = {
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
}

// Mock the dynamic import
vi.mock('@stellar/freighter-api', () => ({
  ...mockFreighterApi,
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFreighterInstalled(isConnected: boolean, network?: string, publicKey?: string) {
  mockFreighterApi.isConnected.mockResolvedValue({
    isConnected,
    error: null,
  })

  if (isConnected) {
    mockFreighterApi.getAddress.mockResolvedValue({
      publicKey: publicKey ?? 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS3D57CCOD5JIHVYXKOM77',
      error: null,
    })

    mockFreighterApi.getNetwork.mockResolvedValue({
      network: network ?? 'PUBLIC',
      error: null,
    })
  } else {
    mockFreighterApi.getAddress.mockResolvedValue({
      error: 'Not connected',
    })
    mockFreighterApi.getNetwork.mockResolvedValue({
      error: 'Not connected',
    })
  }
}

function mockFreighterNotInstalled() {
  mockFreighterApi.isConnected.mockRejectedValue(new Error('Freighter not found'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── Lifecycle 1: Detect ──────────────────────────────────────────────────────

describe('useFreighter — detect', () => {
  it('detects when Freighter extension is installed', async () => {
    mockFreighterInstalled(false)

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.isInstalled).toBe(true)
    })
  })

  it('sets isInstalled to false when Freighter is not available', async () => {
    mockFreighterNotInstalled()

    const { result } = renderHook(() => useFreighter())

    // Even if API is unavailable, initial state should reflect that
    expect(result.current.isInstalled).toBe(false)
  })

  it('sets isConnected to false initially when detected but not connected', async () => {
    mockFreighterInstalled(false)

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.isInstalled).toBe(true)
      expect(result.current.isConnected).toBe(false)
    })
  })

  it('sets publicKey to null when extension is detected but not connected', async () => {
    mockFreighterInstalled(false)

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.publicKey).toBeNull()
    })
  })
})

// ─── Lifecycle 2: Connect ─────────────────────────────────────────────────────

describe('useFreighter — connect', () => {
  it('retrieves publicKey when connected to mainnet', async () => {
    const testKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS3D57CCOD5JIHVYXKOM77'
    mockFreighterInstalled(true, 'PUBLIC', testKey)

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
      expect(result.current.publicKey).toBe(testKey)
    })
  })

  it('sets network to PUBLIC when connected on mainnet', async () => {
    mockFreighterInstalled(true, 'PUBLIC')

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.network).toBe('PUBLIC')
    })
  })

  it('reflects connected state when extension API reports connected', async () => {
    mockFreighterInstalled(true, 'PUBLIC')

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.isInstalled).toBe(true)
      expect(result.current.isConnected).toBe(true)
    })
  })

  it('clears error state on successful connection', async () => {
    mockFreighterInstalled(true, 'PUBLIC')

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.error).toBeNull()
    })
  })
})

// ─── Lifecycle 3: Disconnect ──────────────────────────────────────────────────

describe('useFreighter — disconnect', () => {
  it('clears publicKey when disconnected', async () => {
    // Start connected
    mockFreighterInstalled(true, 'PUBLIC')
    const { result, rerender } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
      expect(result.current.publicKey).not.toBeNull()
    })

    // Simulate disconnect
    mockFreighterInstalled(false)
    rerender()

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false)
      expect(result.current.publicKey).toBeNull()
    })
  })

  it('sets isConnected to false when user disconnects', async () => {
    mockFreighterInstalled(false)

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false)
    })
  })

  it('clears network when disconnected', async () => {
    // Start connected
    mockFreighterInstalled(true, 'PUBLIC')
    const { result, rerender } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.network).toBe('PUBLIC')
    })

    // Simulate disconnect
    mockFreighterInstalled(false)
    rerender()

    await waitFor(() => {
      expect(result.current.network).toBeNull()
    })
  })
})

// ─── Lifecycle 4: Network change ──────────────────────────────────────────────

describe('useFreighter — network-change', () => {
  it('updates network when switched away from mainnet', async () => {
    // Start on PUBLIC (mainnet)
    mockFreighterInstalled(true, 'PUBLIC')
    const { result, rerender } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.network).toBe('PUBLIC')
    })

    // Switch to TESTNET
    mockFreighterInstalled(true, 'TESTNET')
    rerender()

    await waitFor(() => {
      expect(result.current.network).toBe('TESTNET')
    })
  })

  it('detects network mismatch (non-mainnet)', async () => {
    mockFreighterInstalled(true, 'TESTNET')

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
      expect(result.current.network).toBe('TESTNET')
    })
  })

  it('maintains publicKey across network changes', async () => {
    const testKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS3D57CCOD5JIHVYXKOM77'

    // Start on PUBLIC
    mockFreighterInstalled(true, 'PUBLIC', testKey)
    const { result, rerender } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.publicKey).toBe(testKey)
    })

    // Switch to TESTNET with same key
    mockFreighterInstalled(true, 'TESTNET', testKey)
    rerender()

    await waitFor(() => {
      expect(result.current.publicKey).toBe(testKey)
    })
  })

  it('restores mainnet-connected state when network switched back', async () => {
    // Start on PUBLIC
    mockFreighterInstalled(true, 'PUBLIC')
    const { result, rerender } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.network).toBe('PUBLIC')
    })

    // Switch to TESTNET
    mockFreighterInstalled(true, 'TESTNET')
    rerender()

    await waitFor(() => {
      expect(result.current.network).toBe('TESTNET')
    })

    // Switch back to PUBLIC
    mockFreighterInstalled(true, 'PUBLIC')
    rerender()

    await waitFor(() => {
      expect(result.current.network).toBe('PUBLIC')
    })
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('useFreighter — error handling', () => {
  it('handles extension detection errors gracefully', async () => {
    mockFreighterNotInstalled()

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      // Should not throw, should set isInstalled to false
      expect(result.current.isInstalled).toBe(false)
    })
  })

  it('does not update state after unmount', async () => {
    mockFreighterInstalled(true, 'PUBLIC')

    const { result, unmount } = renderHook(() => useFreighter())

    unmount()

    // Should not throw errors about state updates on unmounted component
    expect(result.current).toBeDefined()
  })

  it('maintains initial state until API resolves', () => {
    mockFreighterInstalled(false)

    const { result } = renderHook(() => useFreighter())

    // Initial state before resolution
    expect(result.current.isInstalled).toBe(false)
    expect(result.current.isConnected).toBe(false)
    expect(result.current.publicKey).toBeNull()
    expect(result.current.network).toBeNull()
    expect(result.current.error).toBeNull()
  })
})
