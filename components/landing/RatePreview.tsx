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
      <div className="overflow-hidden rounded-xl border border-border">
        <Skeleton rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-status-down/40 bg-bg-sunken p-4">
        <p className="mb-3 text-sm text-status-down">Unable to load rate preview</p>
        <button
          onClick={() => mutate()}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-subtle dark:text-accent dark:hover:bg-bg-sunken"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.corridors.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-sunken p-6 text-center /60">
        <p className="text-sm text-fg-muted">No rate preview available right now.</p>
      </div>
    );
  }

  const corridorsWithBest = data.corridors.filter((c) => c.best !== null);

  if (corridorsWithBest.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-sunken p-6 text-center /60">
        <p className="text-sm text-fg-muted">No anchors are returning rates at the moment.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-sunken /50">
            <th className="px-4 py-3 text-left font-medium text-secondary-text">Corridor</th>
            <th className="px-4 py-3 text-left font-medium text-secondary-text">Best Anchor</th>
            <th className="px-4 py-3 text-right font-medium text-secondary-text">Rate</th>
            <th className="px-4 py-3 text-right font-medium text-secondary-text">You Receive</th>
          </tr>
        </thead>
        <tbody>
          {data.corridors.map((corridor) => (
            <tr key={corridor.corridorId} className="border-t border-border">
              <td className="px-4 py-3">
                <span className="font-medium text-primary-text">
                  {corridor.from}/{corridor.to}
                </span>
              </td>
              <td className="px-4 py-3 text-secondary-text">
                {corridor.best ? corridor.best.anchorName : '—'}
              </td>
              <td className="px-4 py-3 text-right text-secondary-text">
                {corridor.best
                  ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(corridor.best.exchangeRate)} ${corridor.to.toUpperCase()}`
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-primary-text">
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
