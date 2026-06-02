import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useFreighter } from '@/hooks/useFreighter'

/**
 * Tests for mid-session Freighter install detection (#041).
 *
 * Covers:
 * - 2s polling phase (first 30s): extension appearing mid-session is detected quickly
 * - Post-30s phase: window focus and visibilitychange events trigger re-detection
 * - Cleanup: timers and listeners are removed on unmount
 */

// ─── Mock Freighter API ───────────────────────────────────────────────────────

const mockApi = vi.hoisted(() => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  requestAccess: vi.fn(),
  WatchWalletChanges: class {
    watch = vi.fn()
    stop = vi.fn()
  },
}))

vi.mock('@stellar/freighter-api', () => mockApi)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stubNotInstalled() {
  mockApi.isConnected.mockRejectedValue(new Error('Freighter not found'))
}

function stubInstalled() {
  mockApi.isConnected.mockResolvedValue({ isConnected: false, error: null })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  stubNotInstalled()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Early polling phase (0–30s) ─────────────────────────────────────────────

describe('mid-session install detection — early polling', () => {
  it('detects install within 2s when extension appears after mount', async () => {
    const { result } = renderHook(() => useFreighter())

    // Wait for initial detect() to settle with extension absent
    await act(async () => { await Promise.resolve() })
    expect(result.current.isInstalled).toBe(false)

    // Extension becomes available
    stubInstalled()

    // Advance 2s — early poll fires
    await act(async () => { vi.advanceTimersByTime(2000) })
    await act(async () => { await Promise.resolve() })

    expect(result.current.isInstalled).toBe(true)
  })

  it('does not require a focus event to detect install within 30s', async () => {
    const { result } = renderHook(() => useFreighter())
    await act(async () => { await Promise.resolve() })

    stubInstalled()

    // Advance 4s — two early polls, no user interaction needed
    await act(async () => { vi.advanceTimersByTime(4000) })
    await act(async () => { await Promise.resolve() })

    expect(result.current.isInstalled).toBe(true)
  })
})

// ─── Post-30s event-driven phase ─────────────────────────────────────────────

describe('mid-session install detection — event-driven (after 30s)', () => {
  it('detects install on window focus event after 30s', async () => {
    const { result } = renderHook(() => useFreighter())
    await act(async () => { await Promise.resolve() })

    // Advance past 30s to switch to event-driven phase
    await act(async () => { vi.advanceTimersByTime(30_001) })
    await act(async () => { await Promise.resolve() })

    // Extension becomes available
    stubInstalled()

    // Fire focus event
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { await Promise.resolve() })

    expect(result.current.isInstalled).toBe(true)
  })

  it('detects install on visibilitychange event after 30s', async () => {
    const { result } = renderHook(() => useFreighter())
    await act(async () => { await Promise.resolve() })

    await act(async () => { vi.advanceTimersByTime(30_001) })
    await act(async () => { await Promise.resolve() })

    stubInstalled()

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await Promise.resolve() })

    expect(result.current.isInstalled).toBe(true)
  })

  it('does not fire polls after 30s without a user event', async () => {
    renderHook(() => useFreighter())
    await act(async () => { await Promise.resolve() })

    await act(async () => { vi.advanceTimersByTime(30_001) })

    const callsBefore = mockApi.isConnected.mock.calls.length
    stubInstalled()

    // Advance another 10s — no new polls should fire
    await act(async () => { vi.advanceTimersByTime(10_000) })
    await act(async () => { await Promise.resolve() })

    // isConnected should not have been called again without an event
    expect(mockApi.isConnected.mock.calls.length).toBe(callsBefore)
  })
})

// ─── Cleanup ─────────────────────────────────────────────────────────────────

describe('mid-session install detection — cleanup', () => {
  it('removes event listeners on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const docRemoveSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() => useFreighter())
    await act(async () => { await Promise.resolve() })

    // Enter event-driven phase
    await act(async () => { vi.advanceTimersByTime(30_001) })

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(docRemoveSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })

  it('clears early interval on unmount before 30s', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { unmount } = renderHook(() => useFreighter())
    await act(async () => { await Promise.resolve() })

    unmount()

    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
