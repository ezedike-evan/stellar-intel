'use client'
import type { YieldRate } from '@/types'
import { formatPercent, formatTVL } from '@/lib/stellar'
import { Badge } from '@/components/ui/Badge'

export function YieldCard({ rate }: { rate: YieldRate }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="font-medium text-gray-900 dark:text-white">{rate.protocolName}</div>
      <div className="text-gray-500 dark:text-gray-400">
        APY: {formatPercent(rate.apy)} · TVL: {formatTVL(rate.tvl)}
      </div>
      <Badge risk={rate.riskLevel}>{rate.riskLevel} risk</Badge>
    </div>
  )
}
