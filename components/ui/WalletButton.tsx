'use client'
import { useFreighter } from '@/hooks/useFreighter'
import { truncatePublicKey } from '@/lib/utils'
import { Button } from './Button'

export function WalletButton() {
  const { isInstalled, isConnected, publicKey, network, connect, error } = useFreighter()

  // State 1: not-detected — Freighter extension is not installed
  if (!isInstalled) {
    return (
      <a
        href="https://freighter.app"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        Install Freighter
      </a>
    )
  }

  // State 2: disconnected — extension present, wallet not connected
  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="primary" size="sm" onClick={connect}>
          Connect Wallet
        </Button>
        {error && (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }

  // State 3: wrong-network — connected but not on Mainnet
  if (network !== 'PUBLIC') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 dark:border-amber-700/50 dark:bg-amber-900/20">
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Wrong network
          </span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            Mainnet required
          </span>
        </div>
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Switch to Mainnet to continue.{' '}
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            How to switch
          </a>
        </p>
      </div>
    )
  }

  // State 4: connected — on Mainnet with a valid public key
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
      <span className="font-mono text-sm text-gray-700 dark:text-gray-300">
        {publicKey ? truncatePublicKey(publicKey) : '—'}
      </span>
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Mainnet
      </span>
    </div>
  )
}
