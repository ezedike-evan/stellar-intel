'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';
import { truncatePublicKey } from '@/lib/utils';
import { STELLAR_EXPERT_URL } from '@/constants';
import { Button } from './Button';
import { CopyButton } from './CopyButton';

export function WalletButton() {
  const { isInstalled, isConnected, publicKey, network, connect, disconnect, error } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

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
    );
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
    );
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
    );
  }

  // State 4: connected — on Mainnet with a valid public key
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
      >
        <span className="font-mono text-sm text-gray-700 dark:text-gray-300">
          {publicKey ? truncatePublicKey(publicKey) : '—'}
        </span>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Mainnet
        </span>
        <svg
          className={`h-3.5 w-3.5 text-secondary-text transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {menuOpen && publicKey && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
              {truncatePublicKey(publicKey)}
            </span>
            <CopyButton text={publicKey} />
          </div>
          <a
            href={`${STELLAR_EXPERT_URL}/account/${publicKey}`}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            View on Stellar Expert
          </a>
          <Link
            href="/history"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Transaction history
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              disconnect();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
