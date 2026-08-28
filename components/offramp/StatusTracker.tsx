'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { WithdrawStatusValue, Sep24Transaction } from '@/types';
import { formatDeliveredAmount } from '@/lib/format';
import { resolveAnchorSupportHref, resolveToml } from '@/lib/stellar/sep1';
import {
  terminalErrorMessage,
  statusExplainer,
  statusTimeEstimate,
} from '@/lib/stellar/status-messages';
import { Timeline } from './Timeline';
import { STELLAR_EXPERT_URL } from '@/constants';
import { CopyButton } from '@/components/ui/CopyButton';
import { useShare } from '@/hooks/useShare';
import { TransactionReceipt } from './TransactionReceipt';

const PENDING_ANCHOR_STALL_MS = 10 * 60 * 1000;

interface StatusTrackerProps {
  transactionId: string;
  status: WithdrawStatusValue | undefined;
  amountIn: string | undefined;
  amountInAsset: string | undefined;
  amountOut: string | undefined;
  amountOutAsset: string | undefined;
  amountFee: string | undefined;
  /** ISO 4217 currency code for the destination corridor (e.g. "NGN", "KES"). */
  currencyCode: string;
  stellarTransactionId: string | undefined;
  externalTransactionId: string | undefined;
  refunds?: Sep24Transaction['refunds'];
  isLoading: boolean;
  error: string | undefined;
  /** Successful poll count for the current transaction; drives the "still checking" counter. */
  attemptCount?: number;
  /** Anchor home domain for SEP-1 support contact lookup. */
  anchorHomeDomain?: string;
  onRetryAnchor?: () => void;
  onAdjust?: () => void;
  onDisputeOpen?: (transactionId: string) => void;
}

const STATUS_LABELS: Record<WithdrawStatusValue, string> = {
  incomplete: 'Incomplete',
  pending_user_transfer_start: 'Awaiting your payment',
  pending_user_transfer_complete: 'Payment received, processing',
  pending_external: 'Sending to bank',
  pending_anchor: 'Processing at anchor',
  pending_stellar: 'Confirming on Stellar',
  pending_trust: 'Pending trustline',
  pending_user: 'Action required',
  completed: 'Completed',
  refunded: 'Refunded',
  error: 'Failed',
  no_market: 'No market available',
  too_small: 'Amount too small',
  too_large: 'Amount too large',
  expired: 'Transaction expired',
};

const TERMINAL: WithdrawStatusValue[] = [
  'completed',
  'refunded',
  'error',
  'no_market',
  'too_small',
  'too_large',
  'expired',
];

const DISPUTABLE: WithdrawStatusValue[] = ['completed', 'refunded', 'error'];

function statusColor(status: WithdrawStatusValue | undefined): string {
  if (!status) return 'text-fg-muted';
  if (status === 'completed') return 'text-status-up';
  if (['error', 'no_market', 'too_small', 'too_large'].includes(status)) return 'text-status-down';
  if (status === 'refunded') return 'text-status-unknown';
  return 'text-accent';
}

function statusDot(status: WithdrawStatusValue | undefined): string {
  if (!status) return 'bg-border';
  if (status === 'completed') return 'bg-status-up';
  if (['error', 'no_market', 'too_small', 'too_large'].includes(status)) return 'bg-status-down';
  if (status === 'refunded') return 'bg-status-unknown';
  return 'bg-accent animate-pulse';
}

function isValidStellarTxId(id: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(id);
}

export function StatusTracker({
  transactionId,
  status,
  amountIn,
  amountInAsset,
  amountOut,
  amountOutAsset,
  amountFee,
  currencyCode,
  stellarTransactionId,
  externalTransactionId,
  refunds,
  isLoading,
  error,
  attemptCount = 0,
  anchorHomeDomain,
  onDisputeOpen,
  onAdjust,
}: StatusTrackerProps) {
  const isTerminal = status ? TERMINAL.includes(status) : false;
  const isCompleted = status === 'completed';
  const canDispute = isTerminal && status != null && DISPUTABLE.includes(status);
  const terminalMessage = status ? terminalErrorMessage(status, transactionId) : null;
  const { share, copied: shareCopied } = useShare();

  const [anchorSupportUrl, setAnchorSupportUrl] = useState<string | null>(null);
  const pendingAnchorSinceRef = useRef<number | null>(null);
  const [showStalledSupport, setShowStalledSupport] = useState(false);

  useEffect(() => {
    if (!anchorHomeDomain) {
      setAnchorSupportUrl(null);
      return;
    }
    let cancelled = false;
    void resolveToml(anchorHomeDomain).then((result) => {
      if (!cancelled && result.ok) {
        setAnchorSupportUrl(resolveAnchorSupportHref(result.data));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [anchorHomeDomain]);

  useEffect(() => {
    if (status === 'pending_anchor') {
      pendingAnchorSinceRef.current ??= Date.now();
    } else {
      pendingAnchorSinceRef.current = null;
      setShowStalledSupport(false);
    }
  }, [status]);

  useEffect(() => {
    if (
      status !== 'pending_anchor' ||
      !anchorSupportUrl ||
      pendingAnchorSinceRef.current === null
    ) {
      return;
    }
    const elapsed = Date.now() - pendingAnchorSinceRef.current;
    const remaining = PENDING_ANCHOR_STALL_MS - elapsed;
    if (remaining <= 0) {
      setShowStalledSupport(true);
      return;
    }
    const timerId = window.setTimeout(() => setShowStalledSupport(true), remaining);
    return () => window.clearTimeout(timerId);
  }, [status, anchorSupportUrl]);

  return (
    <div
      className={`rounded-xl border p-5 transition-colors ${
        isCompleted ? 'border-status-up/40 bg-accent-subtle /40 ' : 'border-border'
      }`}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-primary-text">Transaction Status</h3>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="font-mono text-xs text-secondary-text">{transactionId}</p>
            <CopyButton text={transactionId} />
          </div>
        </div>
        {!isTerminal && (
          <span className="flex items-center gap-1 text-xs text-secondary-text">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Live
          </span>
        )}
      </div>

      {isCompleted && amountOut && (
        <div className="mb-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <p className="text-xs font-medium uppercase tracking-wide text-status-up">Delivered</p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums text-status-up">
            {formatDeliveredAmount(amountOut, currencyCode)}
          </p>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${statusDot(status)}`} />
        <span className={`text-sm font-medium ${statusColor(status)}`}>
          {isLoading && !status ? 'Fetching status…' : STATUS_LABELS[status ?? 'incomplete']}
        </span>
      </div>

      {status && statusExplainer(status) && (
        <p className="-mt-3 mb-4 text-xs text-fg-muted">
          {statusExplainer(status)}
          {statusTimeEstimate(status) && (
            <span className="text-secondary-text"> (usually {statusTimeEstimate(status)})</span>
          )}
        </p>
      )}

      {!isTerminal && attemptCount >= 20 && (
        <p className="mb-4 text-xs text-status-unknown">
          This is taking longer than usual. Anchor may be experiencing delays.
        </p>
      )}
      {!isTerminal && attemptCount >= 5 && attemptCount < 20 && (
        <p className="mb-4 text-xs text-secondary-text">
          (checked {attemptCount} times, still waiting...)
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-lg bg-bg-sunken px-3 py-2 text-xs text-status-down">{error}</p>
      )}

      {terminalMessage && (
        <p
          className={`mb-4 rounded-lg px-3 py-2 text-xs ${
            status === 'refunded'
              ? 'bg-bg-sunken text-status-unknown  '
              : 'bg-bg-sunken text-status-down  '
          }`}
        >
          {terminalMessage}
        </p>
      )}

      {showStalledSupport && anchorSupportUrl && (
        <p className="mb-4 rounded-lg bg-bg-sunken px-3 py-2 text-xs text-status-unknown">
          This withdrawal is taking longer than expected.{' '}
          <a
            href={anchorSupportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Contact anchor support
          </a>
        </p>
      )}

      {(amountIn || amountOut) && !isCompleted && status !== 'refunded' && (
        <dl className="mb-4 space-y-1.5 text-sm">
          {amountIn && (
            <div className="flex justify-between">
              <dt className="text-fg-muted">Sent</dt>
              <dd className="font-medium text-primary-text">
                {amountIn} {parseAsset(amountInAsset) || 'USDC'}
              </dd>
            </div>
          )}
          {amountFee && (
            <div className="flex justify-between">
              <dt className="text-fg-muted">Fee</dt>
              <dd className="font-medium text-secondary-text">
                {amountFee} {parseAsset(amountInAsset) || 'USDC'}
              </dd>
            </div>
          )}
          {amountOut && (
            <div className="flex justify-between">
              <dt className="text-fg-muted">You receive</dt>
              <dd className="font-medium text-status-up">
                {amountOut} {parseAsset(amountOutAsset) || currencyCode}
              </dd>
            </div>
          )}
        </dl>
      )}

      {status === 'refunded' && refunds && (
        <div className="mb-4 mt-2 rounded-lg bg-bg-sunken p-4">
          <h4 className="mb-2 text-sm font-semibold text-status-unknown">Refund Details</h4>
          <dl className="space-y-1.5 text-sm">
            {refunds.amount_refunded && (
              <div className="flex justify-between">
                <dt className="text-status-unknown/80 /80">Amount Refunded</dt>
                <dd className="font-medium text-status-unknown dark:text-status-unknown">
                  {refunds.amount_refunded} {parseAsset(amountInAsset) || 'USDC'}
                </dd>
              </div>
            )}
            {refunds.amount_fee && (
              <div className="flex justify-between">
                <dt className="text-status-unknown/80 /80">Refund Fee</dt>
                <dd className="font-medium text-status-unknown dark:text-status-unknown">
                  {refunds.amount_fee} {parseAsset(amountInAsset) || 'USDC'}
                </dd>
              </div>
            )}
          </dl>

          {refunds.payments && refunds.payments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-status-unknown/40/50 /50">
              <p className="text-xs font-semibold text-status-unknown mb-2">Refund Payments</p>
              <div className="space-y-2">
                {refunds.payments.map((p, i) => (
                  <div key={i} className="text-xs bg-bg-subtle/50 dark:bg-black/20 rounded p-2">
                    <div className="flex justify-between mb-1">
                      <span className="text-status-unknown">Amount</span>
                      <span className="font-medium text-status-unknown dark:text-status-unknown">
                        {p.amount}
                      </span>
                    </div>
                    {p.fee && (
                      <div className="flex justify-between mb-1">
                        <span className="text-status-unknown">Fee</span>
                        <span className="font-medium text-status-unknown dark:text-status-unknown">
                          {p.fee}
                        </span>
                      </div>
                    )}
                    <div className="mt-1 pt-1 border-t border-status-unknown/40/30 /30">
                      <span className="text-[10px] font-mono text-status-unknown/80 dark:text-status-unknown break-all">
                        {p.id_type}: {p.id}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {externalTransactionId && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-fg-muted uppercase tracking-wider font-semibold mb-1">
            Bank Transfer ID
          </p>
          <p className="text-sm font-mono text-secondary-text break-all">{externalTransactionId}</p>
        </div>
      )}

      {stellarTransactionId && isValidStellarTxId(stellarTransactionId) && (
        <p className="text-xs text-fg-muted">
          Stellar tx:{' '}
          <a
            href={`${STELLAR_EXPERT_URL}/tx/${stellarTransactionId}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View transaction ${stellarTransactionId} on Stellar Expert (opens in new tab)`}
            className="font-mono text-accent hover:underline dark:text-accent"
          >
            {stellarTransactionId.slice(0, 16)}…
          </a>
        </p>
      )}

      <Timeline status={status} />

      {isCompleted && (
        <div className="mt-4 flex items-center gap-4 border-t border-border pt-4">
          {onAdjust && (
            <button
              onClick={onAdjust}
              className="text-xs font-medium text-accent hover:underline dark:text-accent"
            >
              Off-ramp another amount
            </button>
          )}
          <Link
            href="/history"
            className="text-xs font-medium text-fg-muted hover:underline dark:text-fg-muted"
          >
            View transaction history
          </Link>
          {amountIn && stellarTransactionId && isValidStellarTxId(stellarTransactionId) && (
            <button
              onClick={() =>
                share({
                  text: `I just off-ramped ${amountIn} USDC → ${currencyCode} via Stellar Intel.`,
                  url: `${STELLAR_EXPERT_URL}/tx/${stellarTransactionId}`,
                })
              }
              className="text-xs font-medium text-fg-muted hover:underline dark:text-fg-muted"
            >
              {shareCopied ? 'Copied!' : 'Share'}
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="text-xs font-medium text-fg-muted hover:underline dark:text-fg-muted"
          >
            Download receipt
          </button>
        </div>
      )}

      {isCompleted && (
        <TransactionReceipt
          transactionId={transactionId}
          amountIn={amountIn}
          amountInAsset={amountInAsset}
          amountOut={amountOut}
          amountOutAsset={amountOutAsset}
          amountFee={amountFee}
          currencyCode={currencyCode}
          stellarTransactionId={stellarTransactionId}
          anchorHomeDomain={anchorHomeDomain}
        />
      )}

      {canDispute && onDisputeOpen && (
        <div className="mt-4 pt-4 border-t border-border">
          <button
            onClick={() => onDisputeOpen(transactionId)}
            className="text-xs font-medium text-secondary-text hover:text-status-down dark:hover:text-status-down underline transition-colors"
          >
            Flag incorrect outcome
          </button>
        </div>
      )}
    </div>
  );
}

function parseAsset(assetStr: string | undefined): string | null {
  if (!assetStr) return null;
  if (assetStr === 'stellar:native') return 'XLM';
  if (!assetStr.includes(':')) return assetStr;
  const parts = assetStr.split(':');
  return parts[1] ?? parts[0] ?? null;
}
