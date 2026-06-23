'use client';
import { useState, useCallback } from 'react';
import { formatCurrency, formatRate } from '@/lib/utils';
import type { RateComparison, AnchorRate } from '@/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { QuotePill } from '@/components/ui/QuotePill';

interface RateTableProps {
  rates: RateComparison | undefined;
  isLoading: boolean;
  refreshInflight?: boolean;
  error: string | undefined;
  onSelectAnchor: (rate: AnchorRate) => void;
  /** Disables the off-ramp action (e.g. when the wallet is not on mainnet). */
  executeDisabled?: boolean;
}

export function RateTable({
  rates,
  isLoading,
  refreshInflight,
  error,
  onSelectAnchor,
  executeDisabled,
}: RateTableProps) {
  const [expiredAnchorIds, setExpiredAnchorIds] = useState<Set<string>>(new Set());

  const handleExpire = useCallback((anchorId: string) => {
    setExpiredAnchorIds((prev) => {
      const next = new Set(prev);
      next.add(anchorId);
      return next;
    });
  }, []);

  if (
    (isLoading || refreshInflight) &&
    (!rates || (rates.rates.length === 0 && !rates.pending?.length))
  ) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <Skeleton rows={5} />
      </div>
    );
  }

  return (
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

          {!isLoading &&
            !error &&
            rates &&
            rates.rates.length === 0 &&
            (!rates.pending || rates.pending.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  No rates available for this corridor.
                </td>
              </tr>
            )}

          {!isLoading &&
            !error &&
            rates?.rates.map((rate) => {
              const isExpired = expiredAnchorIds.has(rate.anchorId);
              const isUnavailable = rate.source === 'unavailable' || isExpired;
              const isBest = rate.anchorId === rates.bestRateId && !isUnavailable;
              const currency = rate.corridorId.split('-')[1]?.toUpperCase() ?? '';

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
                      <QuotePill
                        source={isUnavailable ? 'unavailable' : rate.source}
                        expiresAt={rate.expiresAt || undefined}
                        onExpire={() => handleExpire(rate.anchorId)}
                      />
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
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                    {rate.totalReceived !== null
                      ? formatCurrency(rate.totalReceived, currency)
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onSelectAnchor(rate)}
                      disabled={isUnavailable || executeDisabled}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Off-ramp
                    </button>
                  </td>
                </tr>
              );
            })}

          {!isLoading &&
            !error &&
            rates?.pending?.map((pendingAnchor) => (
              <tr
                key={`pending-${pendingAnchor.anchorId}`}
                className="border-t border-gray-200 dark:border-gray-700 opacity-60"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {pendingAnchor.anchorName}
                    </span>
                    <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">
                      Fetching...
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">—</td>
                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">—</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                  —
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    disabled
                    className="rounded-lg bg-gray-300 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed dark:bg-gray-700"
                  >
                    Pending
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
