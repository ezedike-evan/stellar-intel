'use client';

import { RefreshCw } from 'lucide-react';
import useSWR from 'swr';
import { Skeleton } from '@/components/ui/Skeleton';

interface ApiSnapshotResponse {
  generatedAt: string;
  baseAmount: string;
  baseAsset: string;
  corridors: Array<{
    corridorId: string;
    from: string;
    to: string;
    countryCode: string;
    countryName: string;
    quoted: number;
    best: {
      anchorId: string;
      anchorName: string;
      totalReceived: number;
      exchangeRate: number;
      source: 'sep38' | 'sep24-fee' | 'unavailable';
    } | null;
  }>;
}

export function RatePreview() {
  const { data, error, isLoading, mutate } = useSWR<ApiSnapshotResponse>(
    '/api/snapshot?amount=100',
    (url: string) => fetch(url).then((res) => res.json())
  );

  if (isLoading && !data) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <Skeleton rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20">
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">Unable to load rate preview</p>
        <button
          onClick={() => mutate()}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.corridors.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center dark:border-gray-700 dark:bg-gray-900/60">
        <p className="text-sm text-gray-500 dark:text-gray-400">No rate preview available right now.</p>
      </div>
    );
  }

  const corridorsWithBest = data.corridors.filter((c) => c.best !== null);

  if (corridorsWithBest.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center dark:border-gray-700 dark:bg-gray-900/60">
        <p className="text-sm text-gray-500 dark:text-gray-400">No anchors are returning rates at the moment.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Corridor</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Best Anchor</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Rate</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">You Receive</th>
          </tr>
        </thead>
        <tbody>
          {data.corridors.map((corridor) => (
            <tr key={corridor.corridorId} className="border-t border-gray-200 dark:border-gray-700">
              <td className="px-4 py-3">
                <span className="font-medium text-gray-900 dark:text-white">
                  {corridor.from}/{corridor.to}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                {corridor.best ? corridor.best.anchorName : '—'}
              </td>
              <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                {corridor.best
                  ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(corridor.best.exchangeRate)} ${corridor.to.toUpperCase()}`
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                {corridor.best
                  ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(corridor.best.totalReceived)} ${corridor.to.toUpperCase()}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}