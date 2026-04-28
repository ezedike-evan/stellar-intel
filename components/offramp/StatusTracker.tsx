'use client'
import type { WithdrawStatusValue } from '@/types'

interface StatusTrackerProps {
  transactionId: string
  status: WithdrawStatusValue | undefined
  amountIn: string | undefined
  amountOut: string | undefined
  stellarTransactionId: string | undefined
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
}

const TERMINAL: WithdrawStatusValue[] = ['completed', 'refunded', 'error', 'no_market', 'too_small', 'too_large']

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
  amountOut,
  stellarTransactionId,
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
      {(amountIn || amountOut) && (
        <dl className="mb-4 space-y-1.5 text-sm">
          {amountIn && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Sent</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{amountIn} USDC</dd>
            </div>
          )}
          {amountOut && (
            <div className="flex justify-between">
              <dt className="text-gray-500">You receive</dt>
              <dd className="font-medium text-green-600 dark:text-green-400">{amountOut}</dd>
            </div>
          )}
        </dl>
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
    </div>
  )
}
