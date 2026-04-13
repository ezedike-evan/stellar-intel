import useSWR from 'swr';
import { fetchYieldRates } from '@/lib/yield';
import type { YieldRate, YieldAsset } from '@/types';
import { REVALIDATION_INTERVAL } from '@/constants';

export function useYieldRates(asset?: YieldAsset) {
  return useSWR<YieldRate[]>(['yield', asset ?? 'all'], () => fetchYieldRates(asset), {
    refreshInterval: REVALIDATION_INTERVAL,
    revalidateOnFocus: false,
  });
}
