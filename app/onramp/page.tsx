'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WalletButton } from '@/components/ui/WalletButton';
import { CorridorSelector } from '@/components/ui/CorridorSelector';
import { DisclaimerBanner } from '@/components/offramp/DisclaimerBanner';
import { StatusTracker } from '@/components/offramp/StatusTracker';
import { useWallet } from '@/contexts/WalletContext';
import { useDepositRates } from '@/hooks/useDepositRates';
import { useWithdrawStatus, type OutcomeAppendContext } from '@/hooks/useWithdrawStatus';
import { VISIBLE_CORRIDORS } from '@/constants/anchors';
import { getCorridorById, getResolvedAnchorById } from '@/lib/stellar/anchors';
import { initiateDeposit } from '@/lib/stellar/sep24';
import { authenticate } from '@/lib/stellar/sep10';
import { signIntent } from '@/lib/intent/sign';
import type { OnrampIntent } from '@/types/intent';
import type { DepositRate } from '@/types';

/**
 * /onramp — deposit comparator and signed-outcome recording (ONR032 / #1490).
 *
 * This is the lean interim shape of ONR021's page: heading, wallet gating,
 * corridor + fiat amount inputs, an inline estimates table fed by
 * `useDepositRates`, and an inline deposit start (SEP-10 auth →
 * `initiateDeposit` → anchor popup). The dedicated DepositRateTable /
 * DepositDrawer / DepositStatusTracker components (ONR018/ONR020/ONR011)
 * replace the inline pieces when they land; the signing and outcome wiring
 * below is what this issue adds and is written to survive that swap.
 *
 * Tracking reuses `useWithdrawStatus`: SEP-24 serves deposit and withdraw
 * transactions from the same /transaction endpoint with the same statuses.
 */

const DEFAULT_CORRIDOR_ID = 'usdc-ngn';
const DEFAULT_AMOUNT = '100';
const VALID_CORRIDOR_IDS = new Set(VISIBLE_CORRIDORS.map((c) => c.id));
const POSITIVE_DECIMAL_RE = /^\d*\.?\d{0,7}$/;

function isValidAmountParam(value: string): boolean {
  const n = Number(value);
  return POSITIVE_DECIMAL_RE.test(value) && Number.isFinite(n) && n > 0;
}

/** `stellar:CODE:ISSUER` / `stellar:native` → request params for the anchor. */
function parseAssetId(assetId: string): { code: string; issuer: string } {
  if (assetId === 'stellar:native') return { code: 'XLM', issuer: '' };
  const [, code = '', issuer = ''] = assetId.split(':');
  return { code, issuer };
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

  const [trackingTransactionId, setTrackingTransactionId] = useState<string | null>(null);
  const [trackingTransferServer, setTrackingTransferServer] = useState<string | null>(null);
  const [trackingJwt, setTrackingJwt] = useState<string | null>(null);
  const [trackingAnchorHomeDomain, setTrackingAnchorHomeDomain] = useState<string | null>(null);
  const [depositingAnchorId, setDepositingAnchorId] = useState<string | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);

  // Quote context captured when the deposit starts, so the terminal outcome is
  // written through the attested append path with direction: 'deposit'. Public
  // data only — no key material ever crosses this boundary.
  const [outcomeContext, setOutcomeContext] = useState<OutcomeAppendContext | null>(null);

  const { isConnected, publicKey, network } = useWallet();
  const corridor = getCorridorById(corridorId);
  const { rates: comparison, isLoading, error, mutate } = useDepositRates(corridorId, amount);

  const depositStatus = useWithdrawStatus(
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
  const visibleRates = (comparison?.rates ?? []).filter(
    (r) => activeAssetId === null || r.asset === activeAssetId
  );

  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set('corridor', corridorId);
    sp.set('amount', amount);
    if (activeAssetId) sp.set('asset', activeAssetId);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }, [corridorId, amount, activeAssetId, router]);

  const handleAmountChange = useCallback((value: string) => {
    if (value === '' || POSITIVE_DECIMAL_RE.test(value)) setAmount(value);
  }, []);

  const depositDisabled = !isConnected || network !== 'PUBLIC' || depositingAnchorId !== null;

  /**
   * ONR032: once the anchor session exists, bind this deposit to the wallet by
   * signing the onramp intent with Freighter. A declined signature
   * (SIGN_REJECTED) must not lose the deposit: it is still tracked, but no
   * outcome context is set (the append route rejects unsigned outcomes) and no
   * error is surfaced, exactly as /offramp does.
   */
  const onDepositStarted = useCallback(
    async (row: DepositRate, transactionId: string) => {
      if (row.exchangeRate === null || !publicKey) return;

      const { code: assetCode } = parseAssetId(row.asset);
      const intent: OnrampIntent = {
        type: 'onramp',
        sourceAsset: corridor.to,
        destinationAsset: assetCode,
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

  const handleDeposit = useCallback(
    async (row: DepositRate) => {
      if (!publicKey || depositDisabled) return;
      setDepositingAnchorId(row.anchorId);
      setDepositError(null);
      try {
        const anchor = await getResolvedAnchorById(row.anchorId);
        const transferServer = anchor.TRANSFER_SERVER_SEP0024;
        if (!transferServer) {
          throw new Error(`${anchor.name} advertises no SEP-24 transfer server`);
        }
        const { code: assetCode, issuer: assetIssuer } = parseAssetId(row.asset);
        const auth = await authenticate(anchor, publicKey);
        const deposit = await initiateDeposit(anchor, {
          jwt: auth.jwt,
          assetCode,
          assetIssuer,
          account: publicKey,
        });

        window.open(deposit.url, 'stellar_anchor_deposit', 'width=600,height=700');

        setTrackingTransactionId(deposit.id);
        setTrackingTransferServer(transferServer);
        setTrackingJwt(auth.jwt);
        setTrackingAnchorHomeDomain(anchor.homeDomain);

        await onDepositStarted(row, deposit.id);
      } catch (err) {
        setDepositError(err instanceof Error ? err.message : String(err));
      } finally {
        setDepositingAnchorId(null);
      }
    },
    [publicKey, depositDisabled, onDepositStarted]
  );

  const handleDepositAnother = useCallback(() => {
    setTrackingTransactionId(null);
    setTrackingTransferServer(null);
    setTrackingJwt(null);
    setTrackingAnchorHomeDomain(null);
    setOutcomeContext(null);
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-text">On-ramp Comparator</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Compare deposit estimates across Stellar anchors
          </p>
        </div>
        <WalletButton />
      </div>

      <DisclaimerBanner />

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-bg-sunken p-4 sm:grid-cols-3">
        <CorridorSelector value={corridorId} onChange={setCorridorId} assetCode={corridor.from} />
        <div>
          <label htmlFor="deposit-amount" className="mb-1 block text-xs font-medium text-fg-muted">
            Amount ({corridor.to})
          </label>
          <input
            id="deposit-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-primary-text"
            aria-label={`Deposit amount in ${corridor.to}`}
          />
        </div>
        {assetIds.length > 0 && (
          <div>
            <label htmlFor="deposit-asset" className="mb-1 block text-xs font-medium text-fg-muted">
              Receive asset
            </label>
            <select
              id="deposit-asset"
              value={activeAssetId ?? ''}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-primary-text"
            >
              {assetIds.map((id) => (
                <option key={id} value={id}>
                  {parseAssetId(id).code}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!isConnected && (
        <div className="rounded-xl border border-status-unknown/40 bg-bg-sunken px-4 py-3 text-sm text-status-unknown">
          Connect your Freighter wallet to deposit.
        </div>
      )}

      {depositError && (
        <div
          role="alert"
          className="rounded-xl border border-status-down/40 bg-bg-sunken px-4 py-3 text-sm text-status-down"
        >
          {depositError}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-fg-muted">
              <th className="px-4 py-3 font-medium">Anchor</th>
              <th className="px-4 py-3 font-medium">Est. received</th>
              <th className="px-4 py-3 font-medium">Fee</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && !comparison && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-fg-muted">
                  Loading deposit estimates…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-status-down">
                  {error}{' '}
                  <button onClick={() => void mutate()} className="underline">
                    Retry
                  </button>
                </td>
              </tr>
            )}
            {!isLoading && !error && visibleRates.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-fg-muted">
                  No anchor could quote this deposit.
                </td>
              </tr>
            )}
            {visibleRates.map((row) => {
              const { code } = parseAssetId(row.asset);
              return (
                <tr
                  key={`${row.anchorId}-${row.asset}`}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-4 py-3 text-primary-text">{row.anchorName}</td>
                  <td className="px-4 py-3 text-primary-text">
                    {row.totalReceived === null ? '—' : `≈ ${row.totalReceived.toFixed(2)} ${code}`}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {row.fee === null ? '—' : `${row.fee} ${code}`}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {row.source === 'sep38' ? 'Firm' : 'Indicative'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => void handleDeposit(row)}
                      disabled={depositDisabled || row.totalReceived === null}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {depositingAnchorId === row.anchorId ? 'Starting…' : 'Deposit'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {trackingTransactionId && (
        <StatusTracker
          transactionId={trackingTransactionId}
          {...(trackingAnchorHomeDomain ? { anchorHomeDomain: trackingAnchorHomeDomain } : {})}
          status={depositStatus.status}
          amountIn={depositStatus.amountIn}
          amountInAsset={depositStatus.amountInAsset}
          amountOut={depositStatus.amountOut}
          amountOutAsset={depositStatus.amountOutAsset}
          amountFee={depositStatus.amountFee}
          currencyCode={corridor.to}
          stellarTransactionId={depositStatus.stellarTransactionId}
          externalTransactionId={depositStatus.externalTransactionId}
          refunds={depositStatus.refunds}
          isLoading={depositStatus.isLoading}
          error={depositStatus.error}
          attemptCount={depositStatus.attemptCount}
          onAdjust={handleDepositAnother}
        />
      )}
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
