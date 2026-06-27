'use client';
import { Suspense, useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TERMINAL_STATES } from '@/lib/stellar/sep24';
import {
  generateNonce,
  saveJwtToSession,
  loadJwtFromSession,
  clearJwtFromSession,
  buildTrackingSearch,
  parseTrackingParams,
} from '@/lib/session';
import { WalletButton } from '@/components/ui/WalletButton';
import { AmountInput } from '@/components/ui/AmountInput';
import { CorridorSelector } from '@/components/ui/CorridorSelector';
import { RateTable } from '@/components/offramp/RateTable';
import { ExecuteDrawer } from '@/components/offramp/ExecuteDrawer';
import { StatusTracker } from '@/components/offramp/StatusTracker';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import { useWallet } from '@/contexts/WalletContext';
import { useWithdrawStatus } from '@/hooks/useWithdrawStatus';
import type { AnchorRate } from '@/types';

function OfframpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [corridorId, setCorridorId] = useState('usdc-ngn');
  const [amount, setAmount] = useState('100');
  const [selectedRate, setSelectedRate] = useState<AnchorRate | null>(null);

  const [trackingTransactionId, setTrackingTransactionId] = useState<string | null>(null);
  const [trackingTransferServer, setTrackingTransferServer] = useState<string | null>(null);
  const [trackingJwt, setTrackingJwt] = useState<string | null>(null);
  const [trackingNonce, setTrackingNonce] = useState<string | null>(null);
  const [trackingAnchorHomeDomain, setTrackingAnchorHomeDomain] = useState<string | null>(null);

  const { isConnected, publicKey, network } = useWallet();
  const { rates, isLoading, error, mutate, refreshInflight } = useAnchorRates(corridorId, amount);

  const withdrawStatus = useWithdrawStatus(
    trackingTransferServer,
    trackingTransactionId,
    trackingJwt
  );

  useEffect(() => {
    const params = parseTrackingParams(searchParams.toString());
    if (!params) return;
    const jwt = loadJwtFromSession(params.nonce);
    if (!jwt) return;
    setTrackingTransactionId(params.transactionId);
    setTrackingTransferServer(params.transferServer);
    setTrackingJwt(jwt);
    setTrackingNonce(params.nonce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectAnchor = useCallback((rate: AnchorRate) => {
    setSelectedRate(rate);
  }, []);

  const handleDrawerClose = useCallback(() => {
    setSelectedRate(null);
  }, []);

  const handleExecuteStarted = useCallback(
    (transactionId: string, transferServer: string, jwt: string, anchorHomeDomain: string) => {
      const nonce = generateNonce();
      saveJwtToSession(nonce, jwt);
      router.replace(`?${buildTrackingSearch({ transactionId, transferServer, nonce })}`);
      setTrackingTransactionId(transactionId);
      setTrackingTransferServer(transferServer);
      setTrackingJwt(jwt);
      setTrackingNonce(nonce);
      setTrackingAnchorHomeDomain(anchorHomeDomain);
    },
    [router]
  );

  useEffect(() => {
    if (withdrawStatus.status && TERMINAL_STATES.has(withdrawStatus.status) && trackingNonce) {
      clearJwtFromSession(trackingNonce);
      router.replace(window.location.pathname);
    }
  }, [withdrawStatus.status, trackingNonce, router]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Off-ramp Comparator</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Compare USDC withdrawal rates across Stellar anchors in real time
          </p>
        </div>
        <WalletButton />
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 sm:grid-cols-2">
        <CorridorSelector value={corridorId} onChange={setCorridorId} />
        <AmountInput value={amount} onChange={setAmount} />
      </div>

      {!isConnected && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-800/40 dark:bg-yellow-950/20 dark:text-yellow-300">
          Connect your Freighter wallet to execute an off-ramp.
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Available Rates
          </h2>
          <button
            onClick={() => mutate()}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
        <RateTable
          rates={rates}
          isLoading={isLoading}
          refreshInflight={refreshInflight}
          error={error}
          onSelectAnchor={handleSelectAnchor}
          executeDisabled={network !== 'PUBLIC'}
        />
      </div>

      {trackingTransactionId && (
        <StatusTracker
          transactionId={trackingTransactionId}
          {...(trackingAnchorHomeDomain ? { anchorHomeDomain: trackingAnchorHomeDomain } : {})}
          status={withdrawStatus.status}
          amountIn={withdrawStatus.amountIn}
          amountInAsset={withdrawStatus.amountInAsset}
          amountOut={withdrawStatus.amountOut}
          amountOutAsset={withdrawStatus.amountOutAsset}
          amountFee={withdrawStatus.amountFee}
          currencyCode={corridorId.split('-')[1]?.toUpperCase() ?? 'USD'}
          stellarTransactionId={withdrawStatus.stellarTransactionId}
          externalTransactionId={withdrawStatus.externalTransactionId}
          refunds={withdrawStatus.refunds}
          isLoading={withdrawStatus.isLoading}
          error={withdrawStatus.error}
        />
      )}

      <ExecuteDrawer
        rate={selectedRate}
        amount={amount}
        publicKey={publicKey ?? ''}
        onClose={handleDrawerClose}
        onExecuteStarted={handleExecuteStarted}
      />
    </div>
  );
}

export default function OfframpPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl space-y-6 px-4 py-8" />}>
      <OfframpContent />
    </Suspense>
  );
}
