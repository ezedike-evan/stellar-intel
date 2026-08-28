import { STELLAR_NETWORK } from '@/constants';

/**
 * Display-only environment indicator — no toggle, since the network is set
 * by NEXT_PUBLIC_STELLAR_NETWORK at build time, not runtime. Hidden entirely
 * on mainnet.
 */
export function TestnetBanner() {
  if (STELLAR_NETWORK !== 'testnet') return null;

  return (
    <div className="bg-status-unknown px-4 py-1.5 text-center text-xs font-medium text-background">
      ⚠ TESTNET — transactions do not use real funds
    </div>
  );
}
