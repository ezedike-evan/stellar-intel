import { useWallet } from '@/contexts/WalletContext'

/**
 * Hook to consume the global WalletContext state.
 * Ensures all components share a single source of truth for Freighter connectivity.
 */
export function useFreighter() {
  return useWallet()
}
