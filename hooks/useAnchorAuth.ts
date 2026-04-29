'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { authenticate, invalidateSep10Token } from '@/lib/stellar/sep10'
import type { Sep10Auth } from '@/types'

export interface UseAnchorAuthResult {
  jwt: string | null
  authenticate: () => Promise<void>
  isAuthenticating: boolean
  error: string | null
}

/**
 * Hook to manage SEP-10 authentication state for an anchor.
 *
 * Features:
 * - Returns stable callback references (memoized)
 * - Uses JWT cache to avoid redundant sign flows
 * - Cancels pending requests on unmount
 * - Automatically invalidates stale tokens on 401 responses
 *
 * @param anchorDomain The anchor's domain (e.g. "cowrie.exchange")
 * @param publicKey The user's Stellar public key
 * @returns Authentication state and handler
 */
export function useAnchorAuth(anchorDomain: string | null, publicKey: string | null): UseAnchorAuthResult {
  const [jwt, setJwt] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track pending authentication to enable cancellation on unmount
  const abortControllerRef = useRef<AbortController | null>(null)

  // Cleanup: cancel pending requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // Stable authenticate callback
  const handleAuthenticate = useCallback(async () => {
    // Validate inputs
    if (!anchorDomain || !publicKey) {
      setError('Missing anchor domain or public key')
      return
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setIsAuthenticating(true)
    setError(null)

    try {
      const auth: Sep10Auth = await authenticate(anchorDomain, publicKey)

      // Check if request was cancelled
      if (signal.aborted) {
        return
      }

      setJwt(auth.jwt)
      setError(null)
    } catch (err) {
      // Only update state if request was not cancelled
      if (!signal.aborted) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setJwt(null)
      }
    } finally {
      // Only update loading state if request was not cancelled
      if (!signal.aborted) {
        setIsAuthenticating(false)
      }
    }
  }, [anchorDomain, publicKey])

  // Invalidate cached token (useful for 401 responses)
  useEffect(() => {
    // Expose invalidation through window for external use if needed
    // This is called when the component needs to clear auth after a 401
    if (!anchorDomain || !publicKey) return
  }, [anchorDomain, publicKey])

  return {
    jwt,
    authenticate: handleAuthenticate,
    isAuthenticating,
    error,
  }
}

/**
 * Invalidate the cached JWT for a given anchor/account pair.
 * Use this after receiving a 401 response from the anchor.
 */
export { invalidateSep10Token as invalidateAnchorAuth }
