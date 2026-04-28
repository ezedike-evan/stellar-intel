'use client'
import type { WithdrawStatusValue, Sep24Transaction } from '@/types'
import { Timeline } from './Timeline'

interface StatusTrackerProps {
  transactionId: string
  status: WithdrawStatusValue | undefined
  amountIn: string | undefined
  amountInAsset: string | undefined
  amountOut: string | undefined
  amountOutAsset: string | undefined
  amountFee: string | undefined
  stellarTransactionId: string | undefined
  externalTransactionId: string | undefined
  refunds?: Sep24Transaction['refunds']
  isLoading: boolean
  error: string | undefined
  onRetryAnchor?: () => void
  onAdjust?: () => void
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
}

const TERMINAL: WithdrawStatusValue[] = ['completed', 'refunded', 'error', 'no_market', 'too_small', 'too_large', 'expired']

function statusColor(status: WithdrawStatusValue | undefined): string {
  if (!status) return 'text-gray-500'
  if (status === 'completed') return 'text-green-600 dark:text-green-400'
  if (['error', 'no_market', 'too_small', 'too_large'].includes(status))
    return 'text-red-600 dark:text-red-400'
  if (status === 'refunded') return 'text-yellow-600 dark:text-yellow-400'
  return 'text-blue-600 dark:text-blue-400'
}

function statusDot(status: WithdrawStatusValue | undefined): string {
  if (!status) return 'bg-gray-300'
  if (status === 'completed') return 'bg-green-500'
  if (['error', 'no_market', 'too_small', 'too_large'].includes(status)) return 'bg-red-500'
  if (status === 'refunded') return 'bg-yellow-500'
  return 'bg-blue-500 animate-pulse'
}

export function StatusTracker({
  transactionId,
  status,
  amountIn,
  amountInAsset,
  amountOut,
  amountOutAsset,
  amountFee,
  stellarTransactionId,
  externalTransactionId,
  refunds,
  isLoading,
  error,
}: StatusTrackerProps) {
  const isTerminal = status ? TERMINAL.includes(status) : false

  return (
    <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Transaction Status</h3>
          <p className="mt-0.5 font-mono text-xs text-gray-400">{transactionId}</p>
        </div>
        {!isTerminal && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Status badge */}
      <div className="mb-4 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${statusDot(status)}`} />
        <span className={`text-sm font-medium ${statusColor(status)}`}>
          {isLoading && !status ? 'Fetching status…' : STATUS_LABELS[status ?? 'incomplete']}
        </span>
      </div>

      {/* Error message */}
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Amount details */}
      {status !== 'refunded' && (amountIn || amountOut) && (
        <dl className="mb-4 space-y-1.5 text-sm">
          {amountIn && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Sent</dt>
              <dd className="font-medium text-gray-900 dark:text-white">
                {amountIn} {parseAsset(amountInAsset) || 'USDC'}
              </dd>
            </div>
          )}
          {amountFee && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Fee</dt>
              <dd className="font-medium text-gray-700 dark:text-gray-300">
                {amountFee} {parseAsset(amountInAsset) || 'USDC'}
              </dd>
            </div>
          )}
          {amountOut && (
            <div className="flex justify-between">
              <dt className="text-gray-500">You receive</dt>
              <dd className="font-medium text-green-600 dark:text-green-400">
                {amountOut} {parseAsset(amountOutAsset)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* Refund details */}
      {status === 'refunded' && refunds && (
        <div className="mb-4 mt-2 rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
          <h4 className="mb-2 text-sm font-semibold text-yellow-800 dark:text-yellow-300">Refund Details</h4>
          <dl className="space-y-1.5 text-sm">
            {refunds.amount_refunded && (
              <div className="flex justify-between">
                <dt className="text-yellow-700/80 dark:text-yellow-400/80">Amount Refunded</dt>
                <dd className="font-medium text-yellow-900 dark:text-yellow-200">
                  {refunds.amount_refunded} {parseAsset(amountInAsset) || 'USDC'}
                </dd>
              </div>
            )}
            {refunds.amount_fee && (
              <div className="flex justify-between">
                <dt className="text-yellow-700/80 dark:text-yellow-400/80">Refund Fee</dt>
                <dd className="font-medium text-yellow-900 dark:text-yellow-200">
                  {refunds.amount_fee} {parseAsset(amountInAsset) || 'USDC'}
                </dd>
              </div>
            )}
          </dl>
          
          {refunds.payments && refunds.payments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-yellow-200/50 dark:border-yellow-700/50">
              <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-300 mb-2">Refund Payments</p>
              <div className="space-y-2">
                {refunds.payments.map((p, i) => (
                  <div key={i} className="text-xs bg-white/50 dark:bg-black/20 rounded p-2">
                    <div className="flex justify-between mb-1">
                      <span className="text-yellow-700 dark:text-yellow-400">Amount</span>
                      <span className="font-medium text-yellow-900 dark:text-yellow-200">{p.amount}</span>
                    </div>
                    {p.fee && (
                      <div className="flex justify-between mb-1">
                        <span className="text-yellow-700 dark:text-yellow-400">Fee</span>
                        <span className="font-medium text-yellow-900 dark:text-yellow-200">{p.fee}</span>
                      </div>
                    )}
                    <div className="mt-1 pt-1 border-t border-yellow-200/30 dark:border-yellow-700/30">
                      <span className="text-[10px] font-mono text-yellow-600/80 dark:text-yellow-500/80 break-all">
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

      {/* External Transaction ID */}
      {externalTransactionId && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">
            Bank Transfer ID
          </p>
          <p className="text-sm font-mono text-gray-600 dark:text-gray-400 break-all">
            {externalTransactionId}
          </p>
        </div>
      )}

      {/* Stellar tx link */}
      {stellarTransactionId && (
        <p className="text-xs text-gray-500">
          Stellar tx:{' '}
          <span className="font-mono text-gray-700 dark:text-gray-300">
            {stellarTransactionId.slice(0, 16)}…
          </span>
        </p>
      )}

      {/* Vertical Timeline */}
      <Timeline status={status} />
    </div>
  )
}

function parseAsset(assetStr: string | undefined): string | null {
  if (!assetStr) return null
  if (assetStr === 'stellar:native') return 'XLM'
  // stellar:USDC:GA5Z... -> USDC
  const parts = assetStr.split(':')
  return parts[1] ?? null
}
