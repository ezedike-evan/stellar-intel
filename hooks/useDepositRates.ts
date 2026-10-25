'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { AnchorRateError, DepositRateComparison } from '@/types';
import { RATES_REFRESH_INTERVAL_MS } from './useAnchorRates';

/**
 * Deposit estimates for /onramp: the server-side `fetchDepositRates` comparison,
 * read through the public `GET /api/v1/onramp/quote` so the browser never meets
 * an anchor's CORS policy. Every figure is indicative.
 *
 * `rates` is the whole comparison (rows, `bestRateId`); per-anchor failures are
 * surfaced separately as `anchorErrors` so one dead anchor never hides the rest.
 */

export interface UseDepositRatesResult {
  rates: DepositRateComparison | undefined;
  anchorErrors: AnchorRateError[];
  isLoading: boolean;
  error: string | undefined;
  mutate: () => Promise<unknown>;
  /** Epoch ms of the last successful fetch; null before the first one. */
  lastFetchedAt: number | null;
}

interface V1ErrorBody {
  error?: { message?: string };
}

interface DepositRatesWire extends Omit<DepositRateComparison, 'rates'> {
  rates: Array<Omit<DepositRateComparison['rates'][number], 'updatedAt'> & { updatedAt: string }>;
}

async function fetchDepositRatesApi(url: string): Promise<DepositRateComparison> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as V1ErrorBody | null;
    throw new Error(body?.error?.message ?? `Deposit rates request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as DepositRatesWire;
  return {
    ...data,
    rates: data.rates.map((rate) => ({ ...rate, updatedAt: new Date(rate.updatedAt) })),
  };
}

export function useDepositRates(
  corridorId: string | null,
  amount: string,
  asset?: string
): UseDepositRatesResult {
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const amountOk = Number(amount) > 0;
  const key =
    corridorId && amountOk
      ? `/api/v1/onramp/quote?corridor=${encodeURIComponent(corridorId)}&amount=${encodeURIComponent(
          amount
        )}${asset ? `&asset=${encodeURIComponent(asset)}` : ''}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<DepositRateComparison, Error>(
    key,
    fetchDepositRatesApi,
    {
      refreshInterval: RATES_REFRESH_INTERVAL_MS,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
      keepPreviousData: true,
      onSuccess: () => setLastFetchedAt(Date.now()),
    }
  );

  return {
    rates: data,
    anchorErrors: data?.errors ?? [],
    isLoading,
    error: error?.message,
    mutate,
    lastFetchedAt,
  };
}
