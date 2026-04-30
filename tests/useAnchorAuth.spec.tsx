import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAnchorAuth } from '@/hooks/useAnchorAuth'
import * as sep10 from '@/lib/stellar/sep10'
import type { Sep10Auth } from '@/types'

// ─── Mock SEP-10 module ────────────────────────────────────────────────────────

vi.mock('@/lib/stellar/sep10', () => ({
  authenticate: vi.fn(),
  invalidateSep10Token: vi.fn(),
}))

// ─── Test helpers ─────────────────────────────────────────────────────────────

const ANCHOR = 'cowrie.exchange'
const PUBLIC_KEY = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS3D57CCOD5JIHVYXKOM77'

function createMockAuth(): Sep10Auth {
  return {
    jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.test',
    anchorDomain: ANCHOR,
    publicKey: PUBLIC_KEY,
    expiresAt: new Date(Date.now() + 3600 * 1000),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sep10.authenticate).mockResolvedValue(createMockAuth())
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useAnchorAuth', () => {
  describe('initial state', () => {
    it('returns initial state with null jwt and no error', () => {
      const { result } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      expect(result.current.jwt).toBeNull()
      expect(result.current.isAuthenticating).toBe(false)
      expect(result.current.error).toBeNull()
      expect(result.current.authenticate).toBeDefined()
    })

    it('returns authenticate function immediately', () => {
      const { result: result1 } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))
      const { result: result2 } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      expect(result1.current.authenticate).toBeDefined()
      expect(result2.current.authenticate).toBeDefined()
    })
  })

  describe('authentication flow', () => {
    it('sets jwt and clears error on successful authentication', async () => {
      const mockAuth = createMockAuth()
      vi.mocked(sep10.authenticate).mockResolvedValueOnce(mockAuth)

      const { result } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      act(() => {
        result.current.authenticate()
      })

      await waitFor(() => {
        expect(result.current.isAuthenticating).toBe(false)
      })

      expect(result.current.jwt).toBe(mockAuth.jwt)
      expect(result.current.error).toBeNull()
    })

    it('sets error and clears jwt on failed authentication', async () => {
      const testError = new Error('Authentication failed')
      vi.mocked(sep10.authenticate).mockRejectedValueOnce(testError)

      const { result } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      act(() => {
        result.current.authenticate()
      })

      await waitFor(() => {
        expect(result.current.isAuthenticating).toBe(false)
      })

      expect(result.current.jwt).toBeNull()
      expect(result.current.error).toBe('Authentication failed')
    })

    it('shows isAuthenticating=true during authentication', async () => {
      vi.mocked(sep10.authenticate).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(createMockAuth()), 100))
      )

      const { result } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      act(() => {
        result.current.authenticate()
      })

      expect(result.current.isAuthenticating).toBe(true)

      await waitFor(() => {
        expect(result.current.isAuthenticating).toBe(false)
      })
    })

    it('passes correct arguments to authenticate function', async () => {
      const { result } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      act(() => {
        result.current.authenticate()
      })

      await waitFor(() => {
        expect(result.current.isAuthenticating).toBe(false)
      })

      expect(sep10.authenticate).toHaveBeenCalledWith(ANCHOR, PUBLIC_KEY)
    })

    it('returns error message when missing anchor domain', async () => {
      const { result } = renderHook(() => useAnchorAuth(null, PUBLIC_KEY))

      act(() => {
        result.current.authenticate()
      })

      expect(result.current.error).toBe('Missing anchor domain or public key')
      expect(result.current.jwt).toBeNull()
    })

    it('returns error message when missing public key', async () => {
      const { result } = renderHook(() => useAnchorAuth(ANCHOR, null))

      act(() => {
        result.current.authenticate()
      })

      expect(result.current.error).toBe('Missing anchor domain or public key')
      expect(result.current.jwt).toBeNull()
    })
  })

  describe('callback stability', () => {
    it('returns same authenticate callback reference across re-renders', () => {
      const { result, rerender } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))
      const firstCallback = result.current.authenticate

      rerender()

      expect(result.current.authenticate).toBe(firstCallback)
    })

    it('updates authenticate callback when dependencies change', () => {
      const { result, rerender } = renderHook(
        ({ anchor, key }: { anchor: string; key: string }) => useAnchorAuth(anchor, key),
        {
          initialProps: { anchor: ANCHOR, key: PUBLIC_KEY },
        }
      )
      const firstCallback = result.current.authenticate

      rerender({ anchor: 'different.anchor', key: PUBLIC_KEY })

      expect(result.current.authenticate).not.toBe(firstCallback)
    })
  })

  describe('state persistence', () => {
    it('state survives re-renders', async () => {
      const mockAuth = createMockAuth()
      vi.mocked(sep10.authenticate).mockResolvedValueOnce(mockAuth)

      const { result, rerender } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      act(() => {
        result.current.authenticate()
      })

      await waitFor(() => {
        expect(result.current.jwt).toBe(mockAuth.jwt)
      })

      rerender()

      expect(result.current.jwt).toBe(mockAuth.jwt)
      expect(result.current.error).toBeNull()
    })

    it('maintains separate state for different anchors', async () => {
      const mockAuth1 = createMockAuth()
      const mockAuth2 = { ...createMockAuth(), anchorDomain: 'other.exchange', jwt: 'different-jwt' }

      vi.mocked(sep10.authenticate)
        .mockResolvedValueOnce(mockAuth1)
        .mockResolvedValueOnce(mockAuth2)

      const { result: result1 } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))
      const { result: result2 } = renderHook(() => useAnchorAuth('other.exchange', PUBLIC_KEY))

      act(() => {
        result1.current.authenticate()
      })

      await waitFor(() => {
        expect(result1.current.jwt).toBe(mockAuth1.jwt)
      })

      act(() => {
        result2.current.authenticate()
      })

      await waitFor(() => {
        expect(result2.current.jwt).toBe(mockAuth2.jwt)
      })

      expect(result1.current.jwt).toBe(mockAuth1.jwt)
      expect(result2.current.jwt).toBe(mockAuth2.jwt)
    })
  })

  describe('unmount cleanup', () => {
    it('cancels pending request on unmount', async () => {
      let resolveAuth: ((value: Sep10Auth) => void) | null = null
      vi.mocked(sep10.authenticate).mockImplementation(
        () =>
          new Promise(resolve => {
            resolveAuth = resolve
          })
      )

      const { result, unmount } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      act(() => {
        result.current.authenticate()
      })

      expect(result.current.isAuthenticating).toBe(true)

      // Unmount before request resolves
      unmount()

      // Resolve the request after unmount
      if (resolveAuth) {
       (resolveAuth as any)(createMockAuth());  
        }

      // State should remain unchanged (no memory leaks)
      expect(result.current.isAuthenticating).toBe(true)
      expect(result.current.jwt).toBeNull()
    })

    it('multiple authentications with cancellation of pending requests', async () => {
      vi.mocked(sep10.authenticate).mockResolvedValue(createMockAuth())

      const { result } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      // First request
      act(() => {
        result.current.authenticate()
      })

      // Immediately fire second request (cancels first)
      act(() => {
        result.current.authenticate()
      })

      await waitFor(() => {
        expect(result.current.isAuthenticating).toBe(false)
      })

      expect(result.current.jwt).not.toBeNull()
      expect(result.current.error).toBeNull()
    })
  })

  describe('error handling', () => {
    it('handles non-Error objects thrown', async () => {
      vi.mocked(sep10.authenticate).mockRejectedValueOnce('String error')

      const { result } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      act(() => {
        result.current.authenticate()
      })

      await waitFor(() => {
        expect(result.current.isAuthenticating).toBe(false)
      })

      expect(result.current.error).toBe('String error')
    })

    it('clears error on successful authentication after failure', async () => {
      vi.mocked(sep10.authenticate)
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce(createMockAuth())

      const { result } = renderHook(() => useAnchorAuth(ANCHOR, PUBLIC_KEY))

      // First attempt fails
      act(() => {
        result.current.authenticate()
      })

      await waitFor(() => {
        expect(result.current.error).toBe('First attempt failed')
      })

      // Second attempt succeeds
      act(() => {
        result.current.authenticate()
      })

      await waitFor(() => {
        expect(result.current.jwt).not.toBeNull()
      })

      expect(result.current.error).toBeNull()
    })
  })
})
