'use client';

import { formatCurrency, formatRate } from '@/lib/utils';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Corridor } from '@/types';

interface LeaderboardProps {
  corridor: Corridor;
}

export function Leaderboard({ corridor }: LeaderboardProps) {
  const { rates, isLoading, error } = useAnchorRates(corridor.id, '100');
  const currency = corridor.to.toUpperCase();

  if (isLoading && !rates) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <Skeleton rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!rates || rates.rates.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        No anchors available for this corridor.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
              Rank
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
              Anchor
            </th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
              Rate (per USDC)
            </th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
              Fee
            </th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
              You Receive
            </th>
          </tr>
        </thead>
        <tbody>
          {rates.rates.map((rate, index) => {
            const isBest = rate.anchorId === rates.bestRateId;
            const isUnavailable = rate.source === 'unavailable';

            return (
              <tr
                key={rate.anchorId}
                className={
                  isBest && !isUnavailable
                    ? 'border-t border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20'
                    : 'border-t border-gray-200 dark:border-gray-700'
                }
              >
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                  {isUnavailable ? '—' : `#${index + 1}`}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {rate.anchorName}
                    </span>
                    {isBest && !isUnavailable && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        Best
                      </span>
                    )}
                    {isUnavailable && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                        Unavailable
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                  {rate.exchangeRate !== null && rate.exchangeRate > 0
                    ? formatRate(rate.exchangeRate, 'USDC', currency)
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                  {rate.fee !== null ? formatCurrency(rate.fee, 'USD') : '—'}
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                  {rate.totalReceived !== null ? formatCurrency(rate.totalReceived, currency) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
