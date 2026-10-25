'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { WalletButton } from '@/components/ui/WalletButton';
import { CorridorSelector } from '@/components/ui/CorridorSelector';
import { DisclaimerBanner } from '@/components/offramp/DisclaimerBanner';
import { DepositRateTable } from '@/components/onramp/DepositRateTable';
import { DepositStatusTracker } from '@/components/onramp/DepositStatusTracker';
import { useWallet } from '@/contexts/WalletContext';
import { useDepositRates } from '@/hooks/useDepositRates';
import { useTransferStatus, type OutcomeAppendContext } from '@/hooks/useWithdrawStatus';
import { VISIBLE_CORRIDORS } from '@/constants/anchors';
import { getCorridorById } from '@/lib/stellar/anchors';
import { signIntent } from '@/lib/intent/sign';
import {
  buildTrackingSearch,
  clearJwtFromSession,
  generateNonce,
  loadJwtFromSession,
  parseTrackingParams,
  saveJwtToSession,
} from '@/lib/session';
import { TERMINAL_STATES } from '@/lib/stellar/sep24';
import type { OnrampIntent } from '@/types/intent';
import type { DepositRate } from '@/types';

// Only needed once the user picks a row, so it stays out of the initial bundle.
const DepositDrawer = dynamic(
  () => import('@/components/onramp/DepositDrawer').then((mod) => mod.DepositDrawer),
  { ssr: false }
);

/**
 * /onramp — deposit comparator: compare estimates across anchors, start the
 * interactive SEP-24 deposit in a drawer, and track it to completion.
 *
 * Tracking reuses `useTransferStatus`: SEP-24 serves deposit and withdraw
 * transactions from the same /transaction endpoint with the same statuses. Once
 * a deposit starts, the wallet-signed onramp intent is attached so its terminal
 * outcome is recorded through the attested append path with direction 'deposit'.
 *
 * A deposit can take hours while the user sends fiat, so tracking survives a
 * reload or a return from the anchor: the SEP-10 JWT is kept in sessionStorage
 * under a nonce, and `tx`/`server`/`nonce` in the URL point back at it. They are
 * cleared once the transaction reaches a terminal status.
 */

const DEFAULT_CORRIDOR_ID = 'usdc-ngn';
const DEFAULT_AMOUNT = '100';
const VALID_CORRIDOR_IDS = new Set(VISIBLE_CORRIDORS.map((c) => c.id));
const POSITIVE_DECIMAL_RE = /^\d*\.?\d{0,7}$/;

function isValidAmountParam(value: string): boolean {
  const n = Number(value);
  return POSITIVE_DECIMAL_RE.test(value) && Number.isFinite(n) && n > 0;
}

/** `stellar:CODE:ISSUER` / `stellar:native` → the asset's code. */
function assetCodeOf(assetId: string): string {
  if (assetId === 'stellar:native') return 'XLM';
  return assetId.split(':')[1] ?? '';
}

function OnrampContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialCorridorParam = searchParams.get('corridor');
  const initialAmountParam = searchParams.get('amount');
  const initialAssetParam = searchParams.get('asset');

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
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(initialAssetParam);
  const [selectedRate, setSelectedRate] = useState<DepositRate | null>(null);

  const [trackingTransactionId, setTrackingTransactionId] = useState<string | null>(null);
  const [trackingTransferServer, setTrackingTransferServer] = useState<string | null>(null);
  const [trackingJwt, setTrackingJwt] = useState<string | null>(null);
  const [trackingNonce, setTrackingNonce] = useState<string | null>(null);
  const [trackingAnchorHomeDomain, setTrackingAnchorHomeDomain] = useState<string | null>(null);

  // Quote context captured when the deposit starts, so the terminal outcome is
  // written through the attested append path with direction: 'deposit'. Public
  // data only: no key material ever crosses this boundary.
  const [outcomeContext, setOutcomeContext] = useState<OutcomeAppendContext | null>(null);

  const { isConnected, publicKey, network } = useWallet();
  const corridor = getCorridorById(corridorId);
  const {
    rates: comparison,
    anchorErrors,
    isLoading,
    error,
    mutate,
  } = useDepositRates(corridorId, amount);

  const depositStatus = useTransferStatus(
    trackingTransferServer,
    trackingTransactionId,
    trackingJwt,
    outcomeContext ?? undefined
  );

  // The distinct assets in the current comparison, for the asset selector.
  const assetIds = useMemo(
    () => [...new Set((comparison?.rates ?? []).map((r) => r.asset))],
    [comparison]
  );
  const activeAssetId =
    selectedAssetId && assetIds.includes(selectedAssetId) ? selectedAssetId : (assetIds[0] ?? null);
  const visibleComparison = useMemo(
    () =>
      comparison && {
        ...comparison,
        rates: comparison.rates.filter((r) => activeAssetId === null || r.asset === activeAssetId),
      },
    [comparison, activeAssetId]
  );

  // Restore tracking after a reload or a redirect back from the anchor. Without
  // the JWT in this tab's session there is nothing to poll with, so the page
  // renders no tracker rather than one that can only fail.
  useEffect(() => {
    const params = parseTrackingParams(searchParams.toString());
    if (!params) return;
    const jwt = loadJwtFromSession(params.nonce);
    if (!jwt) return;
    setTrackingTransactionId(params.transactionId);
    setTrackingTransferServer(params.transferServer);
    setTrackingJwt(jwt);
    setTrackingNonce(params.nonce);
    // Mount only: later URL changes are this page's own writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Tracking params own the URL while a deposit is in flight, so don't clobber
    // them with corridor/amount. Reading the raw `tx` param, not the state, avoids
    // a race on first mount where this runs before the restore effect above lands.
    if (trackingTransactionId || searchParams.get('tx')) return;
    const sp = new URLSearchParams();
    sp.set('corridor', corridorId);
    sp.set('amount', amount);
    if (activeAssetId) sp.set('asset', activeAssetId);
    router.replace(`?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridorId, amount, activeAssetId, trackingTransactionId]);

  useEffect(() => {
    if (depositStatus.status && TERMINAL_STATES.has(depositStatus.status) && trackingNonce) {
      clearJwtFromSession(trackingNonce);
      router.replace(window.location.pathname);
    }
  }, [depositStatus.status, trackingNonce, router]);

  const handleAmountChange = useCallback((value: string) => {
    if (value === '' || POSITIVE_DECIMAL_RE.test(value)) setAmount(value);
  }, []);

  const depositDisabled = !isConnected || network !== 'PUBLIC';

  /**
   * Once the anchor session exists, bind this deposit to the wallet by signing the
   * onramp intent with Freighter. A declined signature (SIGN_REJECTED) must not
   * lose the deposit: it is still tracked, but no outcome context is set (the
   * append route rejects unsigned outcomes) and no error is surfaced, exactly as
   * /offramp does.
   */
  const recordOutcomeIntent = useCallback(
    async (row: DepositRate, transactionId: string) => {
      if (row.exchangeRate === null || !publicKey) return;

      const intent: OnrampIntent = {
        type: 'onramp',
        sourceAsset: corridor.to,
        destinationAsset: assetCodeOf(row.asset),
        amount,
        sender: publicKey,
        destination: publicKey,
        depositMethod: 'bank_transfer',
      };
      // `recipient` + `transactionId` bind the hash to this anchor session,
      // mirroring the off-ramp outcome intent.
      const hashedIntent = { ...intent, recipient: row.anchorId, transactionId };
      const quote = {
        anchorId: row.anchorId,
        corridor: corridorId,
        quotedRate: row.exchangeRate.toFixed(10).replace(/\.?0+$/, ''),
        quotedAmount: amount,
        direction: 'deposit' as const,
      };

      try {
        const { intentHash, signature, publicKey: signer } = await signIntent(hashedIntent);
        setOutcomeContext({ ...quote, intentHash, signature, publicKey: signer });
      } catch {
        // A declined or failed signature is best-effort, like the off-ramp page:
        // the deposit itself proceeds, its outcome simply isn't recorded.
      }
    },
    [amount, corridor.to, corridorId, publicKey]
  );

  const handleDepositStarted = useCallback(
    (transactionId: string, transferServer: string, jwt: string, anchorHomeDomain: string) => {
      const nonce = generateNonce();
      saveJwtToSession(nonce, jwt);
      router.replace(`?${buildTrackingSearch({ transactionId, transferServer, nonce })}`);
      setTrackingTransactionId(transactionId);
      setTrackingTransferServer(transferServer);
      setTrackingJwt(jwt);
      setTrackingNonce(nonce);
      setTrackingAnchorHomeDomain(anchorHomeDomain);

      if (selectedRate) void recordOutcomeIntent(selectedRate, transactionId);
    },
    [router, selectedRate, recordOutcomeIntent]
  );

  const handleStartAnother = useCallback(() => {
    if (trackingNonce) clearJwtFromSession(trackingNonce);
    setTrackingTransactionId(null);
    setTrackingTransferServer(null);
    setTrackingJwt(null);
    setTrackingNonce(null);
    setTrackingAnchorHomeDomain(null);
    setOutcomeContext(null);
  }, [trackingNonce]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-primary-text text-2xl font-bold">On-ramp Comparator</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Compare deposit estimates across Stellar anchors
          </p>
        </div>
        <WalletButton />
      </div>

      <DisclaimerBanner />

      <div className="border-border bg-bg-sunken grid grid-cols-1 gap-4 rounded-xl border p-4 sm:grid-cols-3">
        <CorridorSelector value={corridorId} onChange={setCorridorId} assetCode={corridor.from} />
        <div>
          <label htmlFor="deposit-amount" className="text-fg-muted mb-1 block text-xs font-medium">
            Amount ({corridor.to})
          </label>
          <input
            id="deposit-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            className="border-border bg-bg-base text-primary-text focus-visible:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>
        {assetIds.length > 0 && (
          <div>
            <label htmlFor="deposit-asset" className="text-fg-muted mb-1 block text-xs font-medium">
              Receive asset
            </label>
            <select
              id="deposit-asset"
              value={activeAssetId ?? ''}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              className="border-border bg-bg-base text-primary-text focus-visible:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              {assetIds.map((id) => (
                <option key={id} value={id}>
                  {assetCodeOf(id)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!isConnected && (
        <div className="border-status-unknown/40 bg-bg-sunken text-status-unknown rounded-xl border px-4 py-3 text-sm">
          Connect your Freighter wallet to deposit.
        </div>
      )}
      {isConnected && network !== 'PUBLIC' && (
        <div className="border-status-unknown/40 bg-bg-sunken text-status-unknown rounded-xl border px-4 py-3 text-sm">
          Switch Freighter to the public network to deposit.
        </div>
      )}

      <DepositRateTable
        rates={visibleComparison}
        anchorErrors={anchorErrors}
        isLoading={isLoading}
        error={error}
        fiatCode={corridor.to}
        onSelectAnchor={setSelectedRate}
        executeDisabled={depositDisabled}
        onRefresh={() => void mutate()}
      />

      {trackingTransactionId && (
        <DepositStatusTracker
          transactionId={trackingTransactionId}
          {...(trackingAnchorHomeDomain ? { anchorHomeDomain: trackingAnchorHomeDomain } : {})}
          status={depositStatus.status}
          amountIn={depositStatus.amountIn}
          amountInAsset={depositStatus.amountInAsset}
          amountOut={depositStatus.amountOut}
          amountOutAsset={depositStatus.amountOutAsset}
          amountFee={depositStatus.amountFee}
          instructions={depositStatus.instructions}
          moreInfoUrl={depositStatus.moreInfoUrl}
          message={depositStatus.message}
          claimableBalanceId={depositStatus.claimableBalanceId}
          stellarTransactionId={depositStatus.stellarTransactionId}
          isLoading={depositStatus.isLoading}
          error={depositStatus.error}
          onStartAnother={handleStartAnother}
        />
      )}

      <DepositDrawer
        rate={selectedRate}
        amount={amount}
        publicKey={publicKey ?? ''}
        onClose={() => setSelectedRate(null)}
        onDepositStarted={handleDepositStarted}
      />
    </div>
  );
}

export default function OnrampPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl space-y-6 px-4 py-8" />}>
      <OnrampContent />
    </Suspense>
  );
}
