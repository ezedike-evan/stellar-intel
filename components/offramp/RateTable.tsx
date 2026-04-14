'use client'
import { formatCurrency, formatRate } from '@/lib/utils'
import type { RateComparison, AnchorRate } from '@/types'

interface RateTableProps {
  rates: RateComparison | undefined
  isLoading: boolean
  error: string | undefined
  onSelectAnchor: (rate: AnchorRate) => void
}

function SkeletonRow() {
  return (
    <tr className="border-t border-gray-200 dark:border-gray-700">
      {[1, 2, 3, 4, 5].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </td>
      ))}
    </tr>
  )
}

export function RateTable({ rates, isLoading, error, onSelectAnchor }: RateTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Anchor</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Fee</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Rate</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">You Receive</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Action</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          )}

          {!isLoading && error && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center">
                <p className="mb-3 text-sm text-red-500">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs font-medium text-blue-600 underline hover:text-blue-700"
                >
                  Retry
                </button>
              </td>
            </tr>
          )}

          {!isLoading && !error && rates && rates.rates.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                No rates available for this corridor.
              </td>
            </tr>
          )}

          {!isLoading && !error && rates?.rates.map((rate) => {
            const isBest = rate.anchorId === rates.bestRateId
            const currency = rate.corridorId.split('-')[1]?.toUpperCase() ?? ''

            return (
              <tr
                key={rate.anchorId}
                className={
                  isBest
                    ? 'border-t border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20'
                    : 'border-t border-gray-200 dark:border-gray-700'
                }
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {rate.anchorName}
                    </span>
                    {isBest && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        Best Rate
                      </span>
                    )}
                    {rate.source === 'estimated' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Estimated
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                  {formatCurrency(rate.fee, 'USD')}
                </td>
                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                  {rate.exchangeRate > 0
                    ? formatRate(rate.exchangeRate, 'USDC', currency)
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                  {formatCurrency(rate.totalReceived, currency)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onSelectAnchor(rate)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  >
                    Off-ramp
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
