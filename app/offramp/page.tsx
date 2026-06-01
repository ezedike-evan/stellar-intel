'use client';

import { useState, useCallback, useEffect } from 'react';
import { CorridorSelector } from '@/components/ui/CorridorSelector';
import { AmountInput } from '@/components/ui/AmountInput';
import { RateTable } from '@/components/offramp/RateTable';
import { ExecuteDrawer } from '@/components/offramp/ExecuteDrawer';
import { StatusTracker } from '@/components/offramp/StatusTracker';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import { useWithdrawStatus } from '@/hooks/useWithdrawStatus';
import { useWallet } from '@/contexts/WalletContext';
import { CORRIDORS } from '@/constants';
import {
  buildTrackingSearch,
  clearJwtFromSession,
  generateNonce,
  loadJwtFromSession,
  parseTrackingParams,
  saveJwtToSession,
} from '@/lib/session';
import type { AnchorRate } from '@/types';

const DEFAULT_CORRIDOR_ID = CORRIDORS[0]?.id ?? 'usdc-ngn';

export default function OffRampPage() {
  const [selectedCorridorId, setSelectedCorridorId] = useState<string>(DEFAULT_CORRIDOR_ID);
  const [amount, setAmount] = useState('');
  const [selectedRate, setSelectedRate] = useState<AnchorRate | null>(null);
  const [activeTransaction, setActiveTransaction] = useState<{
    transactionId: string;
    transferServer: string;
    jwt: string;
    nonce: string;
    currencyCode: string;
  } | null>(null);
  const { publicKey, connect, error: walletError } = useWallet();

  const { rates, isLoading, error, mutate, refreshInflight } = useAnchorRates(
    selectedCorridorId,
    amount
  );
  const status = useWithdrawStatus(
    activeTransaction?.transferServer ?? null,
    activeTransaction?.transactionId ?? null,
    activeTransaction?.jwt ?? null
  );

  // Rehydrate active transaction from URL + sessionStorage on mount
  useEffect(() => {
    const tracking = parseTrackingParams(window.location.search);
    if (tracking) {
      const jwt = loadJwtFromSession(tracking.nonce);
      if (jwt) {
        setActiveTransaction({
          transactionId: tracking.transactionId,
          transferServer: tracking.transferServer,
          jwt,
          nonce: tracking.nonce,
          currencyCode: selectedCorridorId.split('-')[1]?.toUpperCase() ?? '',
        });
      }
    }
  }, [selectedCorridorId]);

  const handleSelectRate = useCallback(
    async (rate: AnchorRate) => {
      if (!publicKey) {
        await connect();
        return;
      }

      setSelectedRate(rate);
    },
    [connect, publicKey]
  );

  const handleExecuteComplete = useCallback(
    (transactionId: string, transferServer: string, jwt: string) => {
      const nonce = generateNonce();
      saveJwtToSession(nonce, jwt);
      const search = buildTrackingSearch({ transactionId, transferServer, nonce });
      window.history.replaceState(null, '', `${window.location.pathname}?${search}`);
      setActiveTransaction({
        transactionId,
        transferServer,
        jwt,
        nonce,
        currencyCode: selectedCorridorId.split('-')[1]?.toUpperCase() ?? '',
      });
    },
    [selectedCorridorId]
  );

  const handleTrackingComplete = useCallback(() => {
    if (activeTransaction) {
      clearJwtFromSession(activeTransaction.nonce);
    }

    window.history.replaceState(null, '', window.location.pathname);
    setActiveTransaction(null);
  }, [activeTransaction]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (isTyping) return;

      if ((event.key === 'r' || event.key === 'R') && !event.repeat) {
        event.preventDefault();
        void mutate();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mutate]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-white">Off-Ramp</h1>

      <div className="space-y-4">
        <CorridorSelector
          value={selectedCorridorId}
          onChange={(corridorId) => {
            setSelectedCorridorId(corridorId);
            setSelectedRate(null);
          }}
        />
        <AmountInput value={amount} onChange={setAmount} />
      </div>

      {walletError && <p className="mt-3 text-sm text-red-500">{walletError}</p>}

      <div className="mt-6">
        <RateTable
          rates={rates}
          isLoading={isLoading}
          error={error}
          onRefresh={mutate}
          refreshInflight={refreshInflight}
          onSelectAnchor={handleSelectRate}
        />
      </div>

      <ExecuteDrawer
        rate={selectedRate}
        amount={amount}
        publicKey={publicKey ?? ''}
        onClose={() => setSelectedRate(null)}
        onExecuteStarted={handleExecuteComplete}
      />

      {activeTransaction && (
        <StatusTracker
          transactionId={activeTransaction.transactionId}
          status={status.status}
          amountIn={status.amountIn}
          amountInAsset={status.amountInAsset}
          amountOut={status.amountOut}
          amountOutAsset={status.amountOutAsset}
          amountFee={status.amountFee}
          currencyCode={activeTransaction.currencyCode}
          stellarTransactionId={status.stellarTransactionId}
          externalTransactionId={status.externalTransactionId}
          refunds={status.refunds}
          isLoading={status.isLoading}
          error={status.error}
          onAdjust={handleTrackingComplete}
        />
      )}
    </main>
  );
}
