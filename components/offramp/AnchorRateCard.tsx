'use client'
import { formatRate, formatAmount, formatPercent } from '@/lib/stellar'
import type { AnchorRate } from '@/types'

export function AnchorRateCard({ rate, currencySymbol }: { rate: AnchorRate; currencySymbol: string }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="font-medium text-gray-900 dark:text-white">{rate.anchorName}</div>
      <div className="text-gray-500 dark:text-gray-400">
        Rate: {formatRate(rate.exchangeRate, currencySymbol)} · Fee:{' '}
        {formatAmount(rate.fee, 'USD')} + {formatPercent(rate.feePercent)}
      </div>
    </div>
  )
}
