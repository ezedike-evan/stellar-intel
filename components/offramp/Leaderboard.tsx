'use client';

import { formatCurrency, formatRate } from '@/lib/utils';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Corridor } from '@/types';
import { AnchorLogo } from '@/components/ui/AnchorLogo';
import { QuotePill } from '@/components/ui/QuotePill';

interface LeaderboardProps {
  corridor: Corridor;
  /** Cap the number of rows rendered — used by the landing-page teaser variant. */
  limit?: number;
}

export function Leaderboard({ corridor, limit }: LeaderboardProps) {
  const { rates, isLoading, error } = useAnchorRates(corridor.id, '100');
  const currency = corridor.to.toUpperCase();

  if (isLoading && !rates) {
    return (
      <div className="overflow-hidden rounded-xl border border-border">
        <Skeleton rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-xl border border-status-down/40 bg-bg-sunken px-4 py-3 text-sm text-status-down">
        {error}
      </p>
    );
  }

  if (!rates || rates.rates.length === 0) {
    return (
      <p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-fg-muted dark:text-fg-muted">
        No anchors available for this corridor.
      </p>
    );
  }

  const displayRates = limit ? rates.rates.slice(0, limit) : rates.rates;
  const hasReputation = displayRates.some((r) => r.reputationRank != null);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-sunken /50">
            <th className="px-4 py-3 text-left font-medium text-secondary-text">Rate Rank</th>
            <th className="px-4 py-3 text-left font-medium text-secondary-text">Anchor</th>
            {hasReputation && (
              <th
                className="px-4 py-3 text-right font-medium text-secondary-text"
                title="Composite reputation score based on fill rate, slippage, and settlement time"
              >
                Rep. Rank
              </th>
            )}
            <th className="px-4 py-3 text-right font-medium text-secondary-text">
              Rate (per USDC)
            </th>
            <th className="px-4 py-3 text-right font-medium text-secondary-text">Fee</th>
            <th className="px-4 py-3 text-right font-medium text-secondary-text">You Receive</th>
          </tr>
        </thead>
        <tbody>
          {displayRates.map((rate, index) => {
            const isBest = rate.anchorId === rates.bestRateId;
            const isUnavailable = rate.source === 'unavailable';

            return (
              <tr
                key={rate.anchorId}
                className={
                  isBest && !isUnavailable
                    ? 'border-t border-border bg-accent-subtle/50  '
                    : 'border-t border-border'
                }
              >
                <td className="px-4 py-3 text-fg-muted">{isUnavailable ? '—' : `#${index + 1}`}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AnchorLogo anchorId={rate.anchorId} anchorName={rate.anchorName} size="sm" />
                    <span className="font-medium text-primary-text">{rate.anchorName}</span>
                    {isBest && !isUnavailable && (
                      <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
                        Best
                      </span>
                    )}
                    <QuotePill source={rate.source} expiresAt={rate.expiresAt || undefined} />
                  </div>
                </td>
                {hasReputation && (
                  <td className="px-4 py-3 text-right">
                    {rate.reputationRank != null ? (
                      <span
                        title={`Reputation score: ${((rate.reputationScore ?? 0) * 100).toFixed(1)}%`}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          rate.reputationRank === 1
                            ? 'bg-bg-sunken text-status-unknown  '
                            : rate.reputationRank <= 3
                              ? 'bg-accent-subtle text-status-up  '
                              : 'bg-bg-sunken text-secondary-text  '
                        }`}
                      >
                        #{rate.reputationRank}
                      </span>
                    ) : (
                      <span className="text-secondary-text">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-right text-secondary-text">
                  {rate.exchangeRate !== null && rate.exchangeRate > 0
                    ? formatRate(rate.exchangeRate, 'USDC', currency)
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right text-secondary-text">
                  {rate.fee !== null ? formatCurrency(rate.fee, 'USD') : '—'}
                </td>
                <td className="px-4 py-3 text-right font-medium text-primary-text">
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
