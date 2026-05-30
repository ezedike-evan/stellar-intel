'use client';

import { useState, useCallback, useEffect } from 'react';
import { CorridorSelector } from '@/components/offramp/CorridorSelector';
import { AmountInput } from '@/components/offramp/AmountInput';
import { RateTable } from '@/components/offramp/RateTable';
import { ExecuteDrawer } from '@/components/offramp/ExecuteDrawer';
import { StatusTracker } from '@/components/offramp/StatusTracker';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import { CORRIDORS } from '@/constants';
import {
  buildTrackingUrl,
  clearTrackingUrl,
  persistJwt,
  readJwt,
  parseTrackingParams,
  makeNonce,
} from '@/lib/session';

export default function OffRampPage() {
  const [selectedCorridorId, setSelectedCorridorId] = useState<string>(CORRIDORS[0].id);
  const [amount, setAmount] = useState('');
  const [activeTransaction, setActiveTransaction] = useState<{
    transactionId: string;
    transferServer: string;
    jwt: string;
  } | null>(null);

  const { rates, isLoading, error, mutate, refreshInflight } = useAnchorRates(
    selectedCorridorId,
    amount
  );

  // Rehydrate active transaction from URL + sessionStorage on mount
  useEffect(() => {
    const { tx, server, nonce } = parseTrackingParams(window.location.search);
    if (tx && server && nonce) {
      const jwt = readJwt(nonce);
      if (jwt) {
        setActiveTransaction({ transactionId: tx, transferServer: server, jwt });
      }
    }
  }, []);

  const handleExecuteComplete = useCallback(
    (transactionId: string, transferServer: string, jwt: string) => {
      const nonce = makeNonce();
      persistJwt(nonce, jwt);
      window.history.replaceState(null, '', buildTrackingUrl(transactionId, transferServer, nonce));
      setActiveTransaction({ transactionId, transferServer, jwt });
    },
    []
  );

  const handleTrackingComplete = useCallback(() => {
    clearTrackingUrl();
    setActiveTransaction(null);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (isTyping) return;

      if ((event.key === 'r' || event.key === 'R') && !event.repeat) {
        event.preventDefault();
        void mutate();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mutate]);

  const selectedCorridor = CORRIDORS.find((c) => c.id === selectedCorridorId) ?? CORRIDORS[0];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-white">Off-Ramp</h1>

      <div className="space-y-4">
        <CorridorSelector
          corridors={CORRIDORS}
          selectedId={selectedCorridorId}
          onSelect={setSelectedCorridorId}
        />
        <AmountInput value={amount} onChange={setAmount} />
      </div>

      <div className="mt-6">
        <RateTable
          rates={rates}
          isLoading={isLoading}
          error={error}
          onRefresh={mutate}
          refreshInflight={refreshInflight}
        />
      </div>

      {selectedCorridor && (
        <ExecuteDrawer corridor={selectedCorridor} onComplete={handleExecuteComplete} />
      )}

      {activeTransaction && (
        <StatusTracker
          transactionId={activeTransaction.transactionId}
          transferServer={activeTransaction.transferServer}
          jwt={activeTransaction.jwt}
          onComplete={handleTrackingComplete}
        />
      )}
    </main>
  );
}
