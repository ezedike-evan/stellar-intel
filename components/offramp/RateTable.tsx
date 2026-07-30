'use client';
import { Fragment, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { formatCurrency, formatRate } from '@/lib/utils';
import { nextSortState, sortRates, type SortState } from '@/lib/sort';
import { FUNNEL_EVENTS, trackFunnelEvent } from '@/lib/analytics';
import {
  isIndicativeRateSource,
  type RateComparison,
  type AnchorRate,
  type AnchorRateError,
} from '@/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { QuotePill } from '@/components/ui/QuotePill';
import { AnchorLogo } from '@/components/ui/AnchorLogo';
import { CopyButton } from '@/components/ui/CopyButton';
import { SortToggle } from './SortToggle';
import { RateRowDetail } from './RateRowDetail';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

interface RateTableProps {
  rates: RateComparison | undefined;
  isLoading: boolean;
  refreshInflight?: boolean;
  error: string | undefined;
  onSelectAnchor: (rate: AnchorRate) => void;
  /** Disables the off-ramp action (e.g. when the wallet is not on mainnet). */
  executeDisabled?: boolean;
  anchorErrors?: AnchorRateError[];
  /** Re-fetches rates for the current corridor; shown as a CTA on the empty state. */
  onRefresh?: () => void;
}

export function RateTable({
  rates,
  anchorErrors = [],
  isLoading,
  refreshInflight,
  error,
  onSelectAnchor,
  executeDisabled,
  onRefresh,
}: RateTableProps) {
  const [expiredAnchorIds, setExpiredAnchorIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const [expandedAnchorId, setExpandedAnchorId] = useState<string | null>(null);

  const handleExpire = useCallback((anchorId: string) => {
    setExpiredAnchorIds((prev) => {
      const next = new Set(prev);
      next.add(anchorId);
      return next;
    });
  }, []);

  const sortedRates = useMemo(() => sortRates(rates?.rates ?? [], sort), [rates?.rates, sort]);

  // Savings vs. the worst available rate for the same amount — only
  // meaningful (and only shown) when there are at least two comparable rates.
  const savingsVsWorst = useMemo(() => {
    const available = (rates?.rates ?? []).filter(
      (r) => r.source !== 'unavailable' && r.totalReceived !== null
    );
    if (available.length < 2) return null;

    const values = available.map((r) => r.totalReceived!);
    return Math.max(...values) - Math.min(...values);
  }, [rates?.rates]);

  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncedKeyRef = useRef<string | null>(null);
  const lastViewedCorridorRef = useRef<string | null>(null);

  // Fire once per corridor when the rate table first shows results for it.
  useEffect(() => {
    if (!rates?.corridorId) return;
    if (rates.rates.length === 0 && (!rates.pending || rates.pending.length === 0)) return;
    if (lastViewedCorridorRef.current === rates.corridorId) return;
    lastViewedCorridorRef.current = rates.corridorId;
    trackFunnelEvent(FUNNEL_EVENTS.rateTableViewed, { corridor: rates.corridorId });
  }, [rates]);

  useEffect(() => {
    if (!rates || rates.rates.length === 0) return;
    const best = rates.rates.find((r) => r.anchorId === rates.bestRateId);
    if (!best || best.totalReceived == null) return;

    const key = `${best.anchorId}:${best.totalReceived}:${best.exchangeRate ?? ''}`;
    if (lastAnnouncedKeyRef.current === key) return;
    lastAnnouncedKeyRef.current = key;

    const currency = best.corridorId.split('-')[1]?.toUpperCase() ?? '';
    setAnnouncement(
      `Rates updated. Best rate: ${formatCurrency(best.totalReceived, currency)} via ${best.anchorName}.`
    );
  }, [rates]);

  // "Rate moving" badge — flags a >2% shift in the best rate between two
  // revalidations, auto-dismissing after 10s.
  const [volatilityDirection, setVolatilityDirection] = useState<'up' | 'down' | null>(null);
  const prevBestValueRef = useRef<number | null>(null);
  const volatilityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!rates || rates.rates.length === 0) return;
    const best = rates.rates.find((r) => r.anchorId === rates.bestRateId);
    if (!best || best.totalReceived == null) return;

    const prev = prevBestValueRef.current;
    prevBestValueRef.current = best.totalReceived;
    if (prev === null || prev <= 0) return;

    const changePct = ((best.totalReceived - prev) / prev) * 100;
    if (Math.abs(changePct) <= 2) return;

    setVolatilityDirection(changePct > 0 ? 'up' : 'down');
    if (volatilityTimeoutRef.current) clearTimeout(volatilityTimeoutRef.current);
    volatilityTimeoutRef.current = setTimeout(() => setVolatilityDirection(null), 10_000);
  }, [rates]);

  useEffect(() => {
    return () => {
      if (volatilityTimeoutRef.current) clearTimeout(volatilityTimeoutRef.current);
    };
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

  const [sourceCurrency, destCurrency] = (rates?.corridorId ?? '').split('-');
  const anchorCount =
    (rates?.rates.length ?? 0) + anchorErrors.length + (rates?.pending?.length ?? 0);
  const captionText =
    sourceCurrency && destCurrency
      ? `${sourceCurrency.toUpperCase()} to ${destCurrency.toUpperCase()} off-ramp rates — ${anchorCount} anchor${anchorCount === 1 ? '' : 's'}`
      : 'Off-ramp rates';

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {announcement}
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">{captionText}</caption>
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            <th
              scope="col"
              className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400"
            >
              Anchor
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
            >
              <SortToggle
                label="Reputation"
                direction={sort?.key === 'reputation' ? sort.direction : null}
                onClick={() => setSort((prev) => nextSortState(prev, 'reputation'))}
              />
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
            >
              <SortToggle
                label="Fee"
                direction={sort?.key === 'fee' ? sort.direction : null}
                onClick={() => setSort((prev) => nextSortState(prev, 'fee'))}
              />
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
            >
              <SortToggle
                label="Rate"
                direction={sort?.key === 'rate' ? sort.direction : null}
                onClick={() => setSort((prev) => nextSortState(prev, 'rate'))}
              />
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
            >
              <SortToggle
                label="You Receive"
                direction={sort?.key === 'receive' ? sort.direction : null}
                onClick={() => setSort((prev) => nextSortState(prev, 'receive'))}
              />
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
            >
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

          {!isLoading &&
            !error &&
            rates &&
            rates.rates.length === 0 &&
            anchorErrors.length === 0 &&
            (!rates.pending || rates.pending.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    No rates available
                    {sourceCurrency && destCurrency
                      ? ` for ${sourceCurrency.toUpperCase()}→${destCurrency.toUpperCase()} right now.`
                      : ' for this corridor right now.'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Anchors may be temporarily unavailable. Rates refresh every 30 seconds.
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <a
                      href="#corridor-select"
                      className="text-xs font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                    >
                      Try another corridor
                    </a>
                    {onRefresh && (
                      <button
                        onClick={onRefresh}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Refresh now
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

          {!isLoading &&
            !error &&
            sortedRates.map((rate) => {
              const isExpired = expiredAnchorIds.has(rate.anchorId);
              const isUnavailable = rate.source === 'unavailable' || isExpired;
              const isBest = rate.anchorId === rates?.bestRateId && !isUnavailable;
              const currency = rate.corridorId.split('-')[1]?.toUpperCase() ?? '';
              const isExpanded = expandedAnchorId === rate.anchorId;

              return (
                <Fragment key={rate.anchorId}>
                  <tr
                    className={
                      isBest
                        ? 'border-t border-t-blue-200 border-l-[3px] border-l-green-500 bg-blue-50/50 transition-[filter] duration-[120ms] ease-out hover:brightness-[0.98] dark:border-t-blue-900 dark:border-l-green-400 dark:bg-blue-950/20 dark:hover:brightness-110'
                        : 'border-t border-gray-200 transition-colors duration-[120ms] ease-out hover:bg-black/[0.03] dark:border-gray-700 dark:hover:bg-white/5'
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <AnchorLogo anchorId={rate.anchorId} anchorName={rate.anchorName} />
                        <Link
                          href={`/anchors/${rate.anchorId}`}
                          className="font-medium text-gray-900 hover:underline dark:text-white"
                        >
                          {rate.anchorName}
                        </Link>
                        {isBest && (
                          <>
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              Best Rate
                            </span>
                            {isIndicativeRateSource(rate.source) && (
                              <span
                                className="text-xs text-gray-500 dark:text-gray-400"
                                title="This anchor's rate is an estimate, not a firm quote — it may change before you withdraw."
                              >
                                based on an indicative rate
                              </span>
                            )}
                            {savingsVsWorst !== null && savingsVsWorst > 0 && (
                              <span className="text-xs font-medium text-green-600 dark:text-green-400">
                                Save {formatCurrency(savingsVsWorst, currency)} vs others
                              </span>
                            )}
                            {volatilityDirection && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  volatilityDirection === 'up'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                }`}
                              >
                                Rate moving {volatilityDirection === 'up' ? '↑' : '↓'}
                              </span>
                            )}
                            {rate.totalReceived !== null && (
                              <CopyButton
                                text={`Best USDC→${currency} rate: ${formatCurrency(rate.totalReceived, currency)} via ${rate.anchorName}. Checked ${new Date().toLocaleString()} on ${SITE_URL}/offramp?corridor=${rate.corridorId}`}
                              />
                            )}
                          </>
                        )}
                        <QuotePill
                          source={isUnavailable ? 'unavailable' : rate.source}
                          expiresAt={rate.expiresAt || undefined}
                          onExpire={() => handleExpire(rate.anchorId)}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rate.reputationRank != null ? (
                        <span
                          title={`Reputation score: ${((rate.reputationScore ?? 0) * 100).toFixed(1)}%`}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            rate.reputationRank === 1
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                              : rate.reputationRank <= 3
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                          }`}
                        >
                          #{rate.reputationRank}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
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
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setExpandedAnchorId(isExpanded ? null : rate.anchorId)}
                          aria-label={isExpanded ? 'Hide details' : 'Show details'}
                          aria-expanded={isExpanded}
                          className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        >
                          <svg
                            className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onSelectAnchor(rate)}
                          disabled={isUnavailable || executeDisabled}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Off-ramp
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && <RateRowDetail rate={rate} currency={currency} colSpan={6} />}
                </Fragment>
              );
            })}

          {!isLoading &&
            !error &&
            anchorErrors.map((anchorError) => (
              <tr
                key={`error-${anchorError.anchorId}`}
                className="border-t border-gray-200 dark:border-gray-700 opacity-50"
                title={anchorError.reason}
                aria-label={`${anchorError.anchorName} unavailable: ${anchorError.reason}`}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AnchorLogo
                      anchorId={anchorError.anchorId}
                      anchorName={anchorError.anchorName}
                    />
                    <span className="font-medium text-gray-400 dark:text-gray-500">
                      {anchorError.anchorName}
                    </span>
                    <QuotePill source="unavailable" />
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-500">—</td>
                <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-500">—</td>
                <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-500">—</td>
                <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-500">—</td>
                <td className="px-4 py-3 text-right">
                  <button
                    disabled
                    aria-disabled="true"
                    title={anchorError.reason}
                    className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                  >
                    Unavailable
                  </button>
                </td>
              </tr>
            ))}

          {!isLoading &&
            !error &&
            rates?.pending?.map((pendingAnchor) => (
              <tr
                key={`pending-${pendingAnchor.anchorId}`}
                className="border-t border-gray-200 dark:border-gray-700 opacity-60"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AnchorLogo
                      anchorId={pendingAnchor.anchorId}
                      anchorName={pendingAnchor.anchorName}
                    />
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
