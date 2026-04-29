import useSWR from "swr";
import type { ApiRatesResponse, RateComparison } from "@/types";
import { useState, useCallback } from "react";

async function fetcher([, corridorId, amount]: [string, string, string]): Promise<RateComparison> {
  const url = new URL("/api/rates", window.location.origin);
  url.searchParams.set("corridor", corridorId);
  url.searchParams.set("amount", amount);

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
  mutate: () => Promise<void>;
  refreshInflight: boolean;
}


export function useAnchorRates(
  corridorId: string,
  amount: string
): UseAnchorRatesResult {
  const [refreshInflight, setRefreshInflight] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<
    RateComparison,
    Error
  >(
    corridorId && amount ? ["/api/rates", corridorId, amount] : null,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    }
  );

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