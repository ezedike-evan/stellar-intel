'use client';
import { useFreighter } from '@/hooks/useFreighter';
import { truncatePublicKey } from '@/lib/utils';
import { Button } from './Button';

/**
 * Renders the correct wallet state:
 * - Extension not installed → link to freighter.app
 * - Installed, not connected → Connect Wallet button
 * - Connecting → loading state
 * - Connected → truncated public key + Mainnet badge
 * - Error → error message below the button
 */
export function WalletButton() {
  const { isInstalled, isConnected, publicKey, connect, error } = useFreighter();

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
    );
  }

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
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
        <span className="text-sm font-mono text-gray-700 dark:text-gray-300">
          {publicKey ? truncatePublicKey(publicKey) : '—'}
        </span>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Mainnet
        </span>
      </div>
      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
