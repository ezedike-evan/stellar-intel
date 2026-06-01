'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { formatCurrency, formatRate } from '@/lib/utils';
import type { RateComparison, AnchorRate } from '@/types';
import { Skeleton } from '@/components/ui/Skeleton';

function sourceBadge(source: AnchorRate['source']): ReactNode {
  switch (source) {
    case 'sep38':
      return (
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
          SEP-38
        </span>
      );
    case 'sep24-fee':
      return null;
    case 'unavailable':
      return (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
          Unavailable
        </span>
      );
    default: {
      const _exhaustive: never = source;
      void _exhaustive;
      return null;
    }
  }
}

function formatSettlementTime(rate: AnchorRate): string {
  const p50 = (rate as AnchorRate & { p50SettlementMs?: number }).p50SettlementMs;
  if (p50 != null && p50 > 0) {
    const mins = Math.round(p50 / 60000);
    return mins < 1 ? '< 1 min' : `~${mins} min`;
  }
  return '—';
}

interface RateTableProps {
  rates: RateComparison | undefined;
  isLoading: boolean;
  refreshInflight?: boolean;
  error: string | undefined;
  onSelectAnchor: (rate: AnchorRate) => void;
  onRefresh?: () => void;
}

export function RateTable({
  rates,
  isLoading,
  refreshInflight,
  error,
  onSelectAnchor,
  onRefresh,
}: RateTableProps) {
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key === 'R' && onRefresh && !refreshInflight) {
        event.preventDefault();
        onRefresh();
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [onRefresh, refreshInflight]);

  if ((isLoading || refreshInflight) && (!rates || rates.rates.length === 0)) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <Skeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshInflight}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-300 dark:hover:bg-gray-800"
          title="Refresh rates (⇧R)"
        >
          <svg
            className={`h-4 w-4 ${refreshInflight ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      )}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                Anchor
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
                Fee
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
                Rate
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
                Est. Time
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
                You Receive
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
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
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  No rates available for this corridor.
                </td>
              </tr>
            )}

            {!isLoading &&
              !error &&
              rates?.rates.map((rate) => {
                const isBest = rate.anchorId === rates.bestRateId;
                const isUnavailable = rate.source === 'unavailable';
                const currency = rate.corridorId.split('-')[1]?.toUpperCase() ?? '';

                return (
                  <tr
                    id={`anchor-row-${rate.anchorId}`}
                    key={rate.anchorId}
                    className={
                      isBest && !isUnavailable
                        ? 'border-t border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20'
                        : 'border-t border-gray-200 dark:border-gray-700'
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {rate.anchorName}
                        </span>
                        {isBest && !isUnavailable && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            Best Rate
                          </span>
                        )}
                        {sourceBadge(rate.source)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                      {rate.fee !== null ? formatCurrency(rate.fee, 'USD') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                      {rate.exchangeRate !== null && rate.exchangeRate > 0
                        ? formatRate(rate.exchangeRate, 'USDC', currency)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 tabular-nums">
                      {formatSettlementTime(rate)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                      {rate.totalReceived !== null
                        ? formatCurrency(rate.totalReceived, currency)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onSelectAnchor(rate)}
                        disabled={isUnavailable}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Off-ramp
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
