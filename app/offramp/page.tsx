'use client';
import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
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
import { RateTableHeader } from '@/components/offramp/RateTableHeader';
import { StatusTracker } from '@/components/offramp/StatusTracker';
import { DisclaimerBanner } from '@/components/offramp/DisclaimerBanner';
import { TrustBar } from '@/components/offramp/TrustBar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useAnchorRates, RATES_REFRESH_INTERVAL_MS } from '@/hooks/useAnchorRates';
import { useCountdown } from '@/hooks/useCountdown';
import { useWallet } from '@/contexts/WalletContext';
import { useWithdrawStatus, type OutcomeAppendContext } from '@/hooks/useWithdrawStatus';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { amountBucket, FUNNEL_EVENTS, trackFunnelEvent } from '@/lib/analytics';
import { VISIBLE_CORRIDORS } from '@/constants/anchors';
import type { AnchorRate } from '@/types';

// Not needed until the user picks a rate to execute — split into its own
// chunk so it doesn't pad the initial /offramp bundle.
const ExecuteDrawer = dynamic(
  () => import('@/components/offramp/ExecuteDrawer').then((mod) => mod.ExecuteDrawer),
  { ssr: false }
);

const DEFAULT_CORRIDOR_ID = 'usdc-ngn';
const DEFAULT_AMOUNT = '100';
const VALID_CORRIDOR_IDS = new Set(VISIBLE_CORRIDORS.map((c) => c.id));
const POSITIVE_DECIMAL_RE = /^\d*\.?\d{0,7}$/;

function isValidAmountParam(value: string): boolean {
  const n = Number(value);
  return POSITIVE_DECIMAL_RE.test(value) && Number.isFinite(n) && n > 0;
}

function OfframpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialCorridorParam = searchParams.get('corridor');
  const initialAmountParam = searchParams.get('amount');

  const [corridorId, setCorridorId] = useState(
    initialCorridorParam && VALID_CORRIDOR_IDS.has(initialCorridorParam)
      ? initialCorridorParam
      : DEFAULT_CORRIDOR_ID
  );
  const [amount, setAmount] = useState(
    initialAmountParam && isValidAmountParam(initialAmountParam)
      ? initialAmountParam
      : DEFAULT_AMOUNT
  );
  const [selectedRate, setSelectedRate] = useState<AnchorRate | null>(null);

  const [trackingTransactionId, setTrackingTransactionId] = useState<string | null>(null);
  const [trackingTransferServer, setTrackingTransferServer] = useState<string | null>(null);
  const [trackingJwt, setTrackingJwt] = useState<string | null>(null);
  const [trackingNonce, setTrackingNonce] = useState<string | null>(null);
  const [trackingAnchorHomeDomain, setTrackingAnchorHomeDomain] = useState<string | null>(null);

  // Quote context captured when execution starts, so the terminal outcome of a
  // real off-ramp can be written to the reputation log (#799). Public data only
  // — no key material ever crosses this boundary (see docs/NON_CUSTODY.md).
  const [outcomeContext, setOutcomeContext] = useState<OutcomeAppendContext | null>(null);

  const { isConnected, publicKey, network } = useWallet();
  const { rates, anchorErrors, isLoading, error, mutate, refreshInflight, lastFetchedAt } =
    useAnchorRates(corridorId, amount);
  const { secondsRemaining, elapsedSeconds, prefersReducedMotion, progress, totalSeconds } =
    useCountdown(RATES_REFRESH_INTERVAL_MS, lastFetchedAt);
  const { balance, isLoading: isBalanceLoading } = useWalletBalance(publicKey);
  const withdrawStatus = useWithdrawStatus(
    trackingTransferServer,
    trackingTransactionId,
    trackingJwt,
    outcomeContext ?? undefined
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

  useEffect(() => {
    // Tracking params (tx/server/nonce) own the URL while a withdrawal is in
    // flight — don't clobber them with corridor/amount. Reading the raw
    // `tx` param (rather than the trackingTransactionId state) avoids a race
    // on first mount, where this effect can otherwise run before the
    // sibling effect above finishes restoring tracking state.
    if (trackingTransactionId || searchParams.get('tx')) return;
    const sp = new URLSearchParams();
    sp.set('corridor', corridorId);
    sp.set('amount', amount);
    router.replace(`?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridorId, amount, trackingTransactionId]);

  const handleCorridorChange = useCallback(
    (nextCorridorId: string) => {
      if (nextCorridorId === corridorId) return;
      setCorridorId(nextCorridorId);
      trackFunnelEvent(FUNNEL_EVENTS.corridorSelected, {
        corridor: nextCorridorId,
        amount_bucket: amountBucket(amount),
      });
    },
    [corridorId, amount, setCorridorId]
  );

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

      // Capture the quote so the terminal outcome of this real transaction is
      // logged to the reputation store (#799). The SEP-24 transaction id is the
      // stable per-transaction identity; a null exchangeRate can't be quoted so
      // it's skipped (the user can't execute against an unreachable anchor).
      if (selectedRate && selectedRate.exchangeRate !== null) {
        setOutcomeContext({
          intentHash: transactionId,
          anchorId: selectedRate.anchorId,
          corridor: selectedRate.corridorId,
          quotedRate: String(selectedRate.exchangeRate),
          quotedAmount: amount,
        });
      }
    },
    [router, selectedRate, amount]
  );

  useEffect(() => {
    if (withdrawStatus.status && TERMINAL_STATES.has(withdrawStatus.status) && trackingNonce) {
      clearJwtFromSession(trackingNonce);
      router.replace(window.location.pathname);
    }
  }, [withdrawStatus.status, trackingNonce, router]);

  const rateTableRef = useRef<HTMLDivElement>(null);

  const [corridorAnnouncement, setCorridorAnnouncement] = useState('');
  const isFirstCorridorRenderRef = useRef(true);

  useEffect(() => {
    if (isFirstCorridorRenderRef.current) {
      isFirstCorridorRenderRef.current = false;
      return;
    }
    const [source, dest] = corridorId.split('-');
    setCorridorAnnouncement(
      `Showing ${source?.toUpperCase() ?? ''} to ${dest?.toUpperCase() ?? ''} rates. Loading...`
    );
  }, [corridorId]);

  const handleOffRampAnother = useCallback(() => {
    setTrackingTransactionId(null);
    setTrackingTransferServer(null);
    setTrackingJwt(null);
    setTrackingNonce(null);
    setTrackingAnchorHomeDomain(null);
    setOutcomeContext(null);
    rateTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Keyboard shortcuts: K focuses the corridor selector, R refreshes rates.
  // Inactive while typing in a form control or while ExecuteDrawer is open.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (selectedRate !== null) return;

      const target = event.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      if (isEditable) return;

      if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        document.getElementById('corridor-select')?.focus();
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        void mutate();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mutate, selectedRate]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div aria-live="assertive" className="sr-only">
        {corridorAnnouncement}
      </div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-text">Off-ramp Comparator</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Compare USDC withdrawal rates across Stellar anchors in real time
          </p>
        </div>
        <WalletButton />
      </div>

      <DisclaimerBanner />

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-bg-sunken p-4 /50 sm:grid-cols-2">
        <CorridorSelector value={corridorId} onChange={handleCorridorChange} />
        <AmountInput
          value={amount}
          onChange={setAmount}
          balance={balance}
          isBalanceLoading={isBalanceLoading}
          corridorId={corridorId}
        />
      </div>

      {!isConnected && (
        <div className="rounded-xl border border-status-unknown/40 bg-bg-sunken px-4 py-3 text-sm text-status-unknown /40">
          Connect your Freighter wallet to execute an off-ramp.
        </div>
      )}

      <TrustBar lastFetchedAt={lastFetchedAt} />

      <div ref={rateTableRef}>
        <RateTableHeader
          respondingCount={rates?.rates.length ?? 0}
          totalCount={
            (rates?.rates.length ?? 0) + anchorErrors.length + (rates?.pending?.length ?? 0)
          }
          lastFetchedAt={lastFetchedAt}
          secondsRemaining={secondsRemaining}
          elapsedSeconds={elapsedSeconds}
          prefersReducedMotion={prefersReducedMotion}
          progress={progress}
          totalSeconds={totalSeconds}
          refreshInflight={refreshInflight}
          onRefresh={() => mutate()}
        />
        <ErrorBoundary
          resetKeys={[corridorId, amount]}
          fallback={({ resetErrorBoundary }) => (
            <div className="rounded-xl border border-status-down/40 bg-bg-sunken px-4 py-8 text-center /40">
              <p className="mb-3 text-sm text-status-down">Rate table encountered an error.</p>
              <button
                onClick={resetErrorBoundary}
                className="text-xs font-medium text-accent underline hover:text-accent dark:text-accent"
              >
                Retry
              </button>
            </div>
          )}
        >
          <RateTable
            rates={rates}
            anchorErrors={anchorErrors}
            isLoading={isLoading}
            refreshInflight={refreshInflight}
            error={error}
            onSelectAnchor={handleSelectAnchor}
            executeDisabled={network !== 'PUBLIC'}
            onRefresh={() => mutate()}
          />
        </ErrorBoundary>
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
          attemptCount={withdrawStatus.attemptCount}
          onAdjust={handleOffRampAnother}
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
