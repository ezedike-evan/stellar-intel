import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import type { ApiRatesResponse, RateComparison } from '@/types';

const RATES_REFRESH_INTERVAL_MS = 30_000;

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
    rates: data,
    isLoading,
    error: error?.message,
    mutate: refresh,
    refreshInflight,
  };
}
