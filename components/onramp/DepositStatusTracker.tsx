'use client';
import type { Sep24DepositInstruction, WithdrawStatusValue } from '@/types';
import { STELLAR_EXPERT_URL } from '@/constants';
import { isValidStellarTxId } from '@/lib/format';
import {
  DEPOSIT_STATUS_LABELS,
  statusExplainer,
  statusTimeEstimate,
  terminalErrorMessage,
} from '@/lib/stellar/status-messages';
import { useEffect, useRef } from 'react';
import { CopyButton } from '@/components/ui/CopyButton';
import { Button } from '@/components/ui/Button';
import { ONRAMP_FUNNEL_EVENTS, amountBucket, trackFunnelEvent } from '@/lib/analytics';
import { DepositInstructions } from './DepositInstructions';

interface DepositStatusTrackerProps {
  transactionId: string;
  status: WithdrawStatusValue | undefined;
  amountIn: string | undefined;
  amountInAsset: string | undefined;
  amountOut: string | undefined;
  amountOutAsset: string | undefined;
  amountFee: string | undefined;
  instructions: Record<string, Sep24DepositInstruction> | undefined;
  moreInfoUrl: string | undefined;
  message: string | undefined;
  claimableBalanceId: string | undefined;
  stellarTransactionId: string | undefined;
  isLoading: boolean;
  error: string | undefined;
  anchorHomeDomain?: string;
  onStartAnother: () => void;
}

const USER_MUST_PAY: WithdrawStatusValue[] = ['pending_user_transfer_start', 'incomplete'];

const FAILURE: WithdrawStatusValue[] = ['error', 'no_market', 'too_small', 'too_large', 'expired'];

function parseAsset(assetStr: string | undefined): string | null {
  if (!assetStr) return null;
  if (assetStr === 'stellar:native') return 'XLM';
  if (!assetStr.includes(':')) return assetStr;
  return assetStr.split(':')[1] ?? null;
}

function statusColor(status: WithdrawStatusValue | undefined): string {
  if (!status) return 'text-fg-muted';
  if (status === 'completed') return 'text-status-up';
  if (FAILURE.includes(status)) return 'text-status-down';
  if (status === 'refunded') return 'text-status-unknown';
  return 'text-accent';
}

function statusDot(status: WithdrawStatusValue | undefined): string {
  if (!status) return 'bg-border';
  if (status === 'completed') return 'bg-status-up';
  if (FAILURE.includes(status)) return 'bg-status-down';
  if (status === 'refunded') return 'bg-status-unknown';
  return 'bg-accent animate-pulse';
}

/**
 * The deposit counterpart of the off-ramp StatusTracker: deposit wording, the
 * anchor's payment instructions while the user still has to pay, and the Stellar
 * credit once it lands. Anchor-supplied text is always rendered as text.
 */
export function DepositStatusTracker({
  transactionId,
  status,
  amountIn,
  amountInAsset,
  amountOut,
  amountOutAsset,
  amountFee,
  instructions,
  moreInfoUrl,
  message,
  claimableBalanceId,
  stellarTransactionId,
  isLoading,
  error,
  anchorHomeDomain,
  onStartAnother,
}: DepositStatusTrackerProps) {
  const isCompleted = status === 'completed';
  const isTerminal =
    status != null && (isCompleted || status === 'refunded' || FAILURE.includes(status));
  const mustPay = status != null && USER_MUST_PAY.includes(status);
  const terminalMessage = status ? terminalErrorMessage(status, transactionId) : null;
  const explainer = status ? statusExplainer(status, 'deposit') : null;
  const estimate = status ? statusTimeEstimate(status) : null;
  const outAsset = parseAsset(amountOutAsset);
  const inAsset = parseAsset(amountInAsset);
  const hasTxLink = Boolean(stellarTransactionId && isValidStellarTxId(stellarTransactionId));

  // The payment instructions reached the user: once per transaction.
  const instructionsShownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!mustPay || instructionsShownFor.current === transactionId) return;
    instructionsShownFor.current = transactionId;
    trackFunnelEvent(ONRAMP_FUNNEL_EVENTS.onrampInstructionsShown, {
      direction: 'onramp',
      amount_bucket: amountBucket(amountIn),
    });
  }, [mustPay, transactionId, amountIn]);

  return (
    <div
      className={`rounded-xl border p-5 transition-colors ${
        isCompleted ? 'border-status-up/40' : 'border-border'
      }`}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-primary-text text-sm font-semibold">Deposit status</h3>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="text-secondary-text font-mono text-xs break-all">{transactionId}</p>
            <CopyButton text={transactionId} />
          </div>
          {anchorHomeDomain && <p className="text-fg-muted mt-0.5 text-xs">{anchorHomeDomain}</p>}
        </div>
        {!isTerminal && (
          <span className="text-secondary-text flex items-center gap-1 text-xs">
            <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />
            Live
          </span>
        )}
      </div>

      {isCompleted && amountOut && (
        <p className="text-status-up mb-4 text-2xl font-bold tabular-nums">
          You received {amountOut} {outAsset ?? ''}
        </p>
      )}

      <div className="mb-4 flex items-center gap-2" role="status" aria-live="polite">
        <span className={`h-2.5 w-2.5 rounded-full ${statusDot(status)}`} />
        <span className={`text-sm font-medium ${statusColor(status)}`}>
          {isLoading && !status
            ? 'Fetching status…'
            : DEPOSIT_STATUS_LABELS[status ?? 'incomplete']}
        </span>
      </div>

      {explainer && (
        <p className="text-fg-muted -mt-3 mb-4 text-xs">
          {explainer}
          {estimate && <span className="text-secondary-text"> (usually {estimate})</span>}
        </p>
      )}

      {error && (
        <p className="bg-bg-sunken text-status-down mb-4 rounded-lg px-3 py-2 text-xs">{error}</p>
      )}

      {terminalMessage && (
        <p
          className={`bg-bg-sunken mb-4 rounded-lg px-3 py-2 text-xs ${
            status === 'refunded' ? 'text-status-unknown' : 'text-status-down'
          }`}
        >
          {terminalMessage}
        </p>
      )}

      {mustPay && (
        <div className="mb-4">
          <DepositInstructions
            instructions={instructions}
            moreInfoUrl={moreInfoUrl}
            message={message}
          />
        </div>
      )}

      {!isCompleted && (amountIn || amountOut) && (
        <dl className="mb-4 space-y-1.5 text-sm">
          {amountIn && (
            <div className="flex justify-between">
              <dt className="text-fg-muted">You pay</dt>
              <dd className="text-primary-text font-medium">
                {amountIn} {inAsset ?? ''}
              </dd>
            </div>
          )}
          {amountFee && (
            <div className="flex justify-between">
              <dt className="text-fg-muted">Fee</dt>
              <dd className="text-secondary-text font-medium">
                {amountFee} {inAsset ?? ''}
              </dd>
            </div>
          )}
          {amountOut && (
            <div className="flex justify-between">
              <dt className="text-fg-muted">You receive</dt>
              <dd className="text-status-up font-medium">
                {amountOut} {outAsset ?? ''}
              </dd>
            </div>
          )}
        </dl>
      )}

      {claimableBalanceId && (
        <div className="bg-bg-sunken mb-4 rounded-lg px-3 py-2 text-xs">
          <p className="text-secondary-text">
            Your funds were sent as a claimable balance. Add the trustline and claim it in your
            wallet.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-primary-text font-mono break-all">{claimableBalanceId}</p>
            <CopyButton text={claimableBalanceId} />
          </div>
        </div>
      )}

      {hasTxLink && stellarTransactionId && (
        <p className="text-fg-muted text-xs">
          Stellar tx:{' '}
          <a
            href={`${STELLAR_EXPERT_URL}/tx/${stellarTransactionId}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View transaction ${stellarTransactionId} on Stellar Expert (opens in new tab)`}
            className="text-accent focus-visible:ring-accent font-mono hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {stellarTransactionId.slice(0, 16)}…
          </a>
        </p>
      )}

      {isTerminal && (
        <div className="border-border mt-4 border-t pt-4">
          <Button variant="secondary" onClick={onStartAnother}>
            Start another deposit
          </Button>
        </div>
      )}
    </div>
  );
}
