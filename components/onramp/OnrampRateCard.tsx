'use client';
import type { AnchorRate } from '@/types';
import { formatAmount, formatPercent } from '@/lib/stellar';

export function OnrampRateCard({ rate }: { rate: AnchorRate }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="font-medium text-gray-900 dark:text-white">{rate.anchorName}</div>
      <div className="text-gray-500 dark:text-gray-400">
        Fee: {formatAmount(rate.fee, 'USD')} + {formatPercent(rate.feePercent)}
      </div>
    </div>
  );
}
