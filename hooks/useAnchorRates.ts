import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import type { ApiRatesResponse, AnchorRate, RateComparison } from '@/types';

const RATES_REFRESH_INTERVAL_MS = 30_000;

/**
 * How long a fetched quote is considered valid before a refresh is needed.
 * Anchors typically issue quotes valid for 30 seconds.
 */
export const QUOTE_VALIDITY_MS = 30_000;

/**
 * Refresh is triggered when any row has less than this many milliseconds of
 * validity remaining. Set to 5 000 ms per Issue #087.
 */
export const REFRESH_THRESHOLD_MS = 5_000;

/**
 * How often the watcher polls updatedAt timestamps to check for near-expiry.
 * Kept at 1 s so the trigger fires within 1 s of the threshold being crossed
 * without causing excessive re-renders.
 */
export const EXPIRY_POLL_INTERVAL_MS = 1_000;

function getVisibilitySnapshot(): boolean {
  return typeof document === 'undefined' || !document.hidden;
}

function subscribeToVisibilityChange(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};

  document.addEventListener('visibilitychange', onStoreChange);
  return () => document.removeEventListener('visibilitychange', onStoreChange);
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeToVisibilityChange, getVisibilitySnapshot, () => true);
}

async function fetcher(
  [, corridorId, amount]: [string, string, string],
  { signal }: { signal?: AbortSignal } = {}
): Promise<RateComparison> {
  const url = new URL('/api/rates', window.location.origin);
  url.searchParams.set('corridor', corridorId);
  url.searchParams.set('amount', amount);

  const res = await fetch(url.toString(), { signal });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
  }

  const data: ApiRatesResponse = await res.json();
  return data.rates;
}

export interface UseAnchorRatesResult {
  rates: RateComparison | undefined;
  isLoading: boolean;
  error: string | undefined;
  mutate: () => Promise<void>;
  refreshInflight: boolean;
}

export function useAnchorRates(corridorId: string, amount: string): UseAnchorRatesResult {
  const [refreshInflight, setRefreshInflight] = useState(false);
  const isDocumentVisible = useDocumentVisible();
  const wasDocumentVisible = useRef(isDocumentVisible);
  const hasRateQuery = Boolean(corridorId && amount);
  const swrKey: [string, string, string] | null =
    hasRateQuery && isDocumentVisible ? ['/api/rates', corridorId, amount] : null;

  const { data, error, isLoading, mutate } = useSWR<RateComparison, Error>(swrKey, fetcher, {
    refreshInterval: RATES_REFRESH_INTERVAL_MS,
    refreshWhenHidden: false,
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
  });

  useEffect(() => {
    if (!wasDocumentVisible.current && isDocumentVisible && hasRateQuery) {
      void mutate();
    }

    wasDocumentVisible.current = isDocumentVisible;
  }, [hasRateQuery, isDocumentVisible, mutate]);

  // ─── Auto-refresh watcher (near-expiry) ──────────────────────────────────────
  //
  // Polls every EXPIRY_POLL_INTERVAL_MS. When ANY rate row has less than
  // REFRESH_THRESHOLD_MS of its QUOTE_VALIDITY_MS window remaining, a refresh is
  // triggered for the whole corridor. A ref flag prevents concurrent or
  // back-to-back refresh spam: once a refresh is in-flight the watcher skips
  // until the data updates. The watcher only runs while the document is visible
  // so it honours the tab-hidden pause behaviour.
  const dataRef = useRef<RateComparison | undefined>(data);
  dataRef.current = data;

  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!hasRateQuery || !isDocumentVisible) return;

    const intervalId = setInterval(() => {
      const current = dataRef.current;
      if (!current || refreshingRef.current) return;

      const now = Date.now();
      const anyNearExpiry = current.rates.some((rate) => {
        if (!rate.updatedAt) return false;
        const age = now - new Date(rate.updatedAt).getTime();
        const remaining = QUOTE_VALIDITY_MS - age;
        return remaining < REFRESH_THRESHOLD_MS;
      });

      if (anyNearExpiry) {
        refreshingRef.current = true;

        mutate()
          .catch(() => {
            // Silently swallow refresh errors — the existing stale data remains
            // displayed and the next poll cycle will retry.
          })
          .finally(() => {
            refreshingRef.current = false;
          });
      }
    }, EXPIRY_POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [hasRateQuery, isDocumentVisible, mutate]);

  const annotatedRates = useMemo<RateComparison | undefined>(() => {
    if (!data) return undefined;
    const now = Date.now();
    return {
      ...data,
      rates: data.rates.map((rate) => {
        if (rate.source !== 'sep38' || !rate.updatedAt) return rate;
        const age = now - new Date(rate.updatedAt).getTime();
        const remaining = QUOTE_VALIDITY_MS - age;
        const quoteStatus: AnchorRate['quoteStatus'] =
          refreshingRef.current ? 'refreshing'
          : remaining < REFRESH_THRESHOLD_MS ? 'expiring'
          : 'firm';
        return { ...rate, quoteStatus };
      }),
    };
  // refreshInflight is state (triggers re-render) and serves as proxy for refreshingRef changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, refreshInflight]);

  const refresh = useCallback(async () => {
    if (refreshInflight) return;

    setRefreshInflight(true);

    try {
      // clear stale UI immediately
      await mutate(undefined, { revalidate: false });

      // fetch fresh data
      await mutate();
    } finally {
      setRefreshInflight(false);
    }
  }, [mutate, refreshInflight]);

  return {
    rates: annotatedRates,
    isLoading,
    error: error?.message,
    mutate: refresh,
    refreshInflight,
  };
}
