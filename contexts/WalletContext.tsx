'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { FreighterState } from '@/types'

import {
  UserRejectedError,
  NetworkError,
  ConnectionError,
  UnknownWalletError,
} from '@/lib/stellar/errors'

import { WatchWalletChanges } from '@stellar/freighter-api'

// Freighter API is a browser extension — import lazily to avoid SSR errors
async function getFreighterApi() {
  const mod = await import('@stellar/freighter-api')
  return mod
}

interface WalletContextType extends FreighterState {
  connect: () => Promise<void>
  disconnect: () => void
}

const INITIAL_STATE: FreighterState = {
  isInstalled: false,
  isConnected: false,
  publicKey: null,
  network: null,
  error: null,
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FreighterState>(INITIAL_STATE)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Check extension presence on mount
  useEffect(() => {
    let cancelled = false

    async function checkInstalled() {
      try {
        const { isConnected, getAddress, getNetwork } = await getFreighterApi()
        const connResult = await isConnected()

        if (cancelled) return

        if (connResult.error || !connResult.isConnected) {
          setState((s) => ({ ...s, isInstalled: true, isConnected: false }))
          return
        }

        const [addrResult, netResult] = await Promise.all([getAddress(), getNetwork()])
        if (cancelled) return

        const networkName = netResult.network ?? null
        const networkError =
          networkName !== 'PUBLIC' ? 'Please switch Freighter to Mainnet' : null

        setState({
          isInstalled: true,
          isConnected: true,
          publicKey: addrResult.address ?? null,
          network: networkName,
          error: networkError,
        })
      } catch {
        if (cancelled) return
        setState({ ...INITIAL_STATE, isInstalled: false })
      }
    }

    checkInstalled()

    // Watch for live changes (account/network switches)
    const watcher = new WatchWalletChanges(2000)
    watcher.watch((result: { address?: string; network?: string }) => {
      if (!mountedRef.current) return

      const networkName = result.network ?? null
      const networkError =
        networkName !== 'PUBLIC' ? 'Please switch Freighter to Mainnet' : null

      setState((s: FreighterState) => {
        // Only update if something actually changed to prevent re-render loops
        if (
          s.publicKey === result.address &&
          s.network === networkName &&
          s.error === networkError
        ) {
          return s
        }

        return {
          ...s,
          isConnected: !!result.address,
          publicKey: result.address ?? null,
          network: networkName,
          error: networkError,
        }
      })
    })

    return () => {
      cancelled = true
      watcher.stop()
    }
  }, [])

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, error: null }))
    try {
      const { requestAccess, getAddress, getNetwork } = await getFreighterApi()
      const accessResult = await requestAccess()
      if (accessResult.error) throw new Error(String(accessResult.error))

      const [addrResult, netResult] = await Promise.all([getAddress(), getNetwork()])
      if (!mountedRef.current) return

      const networkName = netResult.network ?? null
      const networkError =
        networkName !== 'PUBLIC' ? 'Please switch Freighter to Mainnet' : null

      setState({
        isInstalled: true,
        isConnected: true,
        publicKey: addrResult.address ?? null,
        network: networkName,
        error: networkError,
      })
    } catch (err) {
      if (!mountedRef.current) return
      
      let mappedError: Error
      const message = err instanceof Error ? err.message : String(err)

      if (message.includes('User rejected')) {
        mappedError = new UserRejectedError()
      } else if (message.includes('switch Freighter to Mainnet') || message.includes('Network mismatch')) {
        mappedError = new NetworkError(message)
      } else if (message.includes('not found') || message.includes('locked')) {
        mappedError = new ConnectionError(message)
      } else {
        mappedError = new UnknownWalletError(message)
      }

      setState((s) => ({
        ...s,
        isConnected: false,
        publicKey: null,
        error: mappedError.message,
      }))
    }
  }, [])

  const disconnect = useCallback(() => {
    setState({
      isInstalled: true,
      isConnected: false,
      publicKey: null,
      network: null,
      error: null,
    })
  }, [])

  const value = {
    ...state,
    connect,
    disconnect,
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}
