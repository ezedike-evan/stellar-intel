import useSWR from 'swr';
import type { ApiRatesResponse, RateComparison, ResolvedAnchor } from '@/types';

async function fetcher([, corridorId, amount]: [string, string, string]): Promise<RateComparison> {
  const url = new URL('/api/rates', window.location.origin);
  url.searchParams.set('corridor', corridorId);
  url.searchParams.set('amount', amount);

  const res = await fetch(url.toString());
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
  mutate: () => void;
  source?: 'live' | 'unavailable';
}

/**
 * Fetches live anchor rates for the given corridor and amount.
 * Refreshes every 30 seconds and revalidates when the tab regains focus.
 */
export function useAnchorRates(
  corridorId: string,
  amount: string,
  anchor?: ResolvedAnchor
): UseAnchorRatesResult {
  const capable =
    anchor === undefined || anchor.capabilities.sep24 || anchor.capabilities.sep38;

  const { data, error, isLoading, mutate } = useSWR<RateComparison, Error>(
    capable ? ['/api/rates', corridorId, amount] : null,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    }
  );

  if (!capable) {
    return {
      rates: undefined,
      isLoading: false,
      error: undefined,
      mutate: () => {},
      source: 'unavailable',
    };
  }

  return {
    rates: data,
    isLoading,
    error: error?.message,
    mutate,
  };
}
