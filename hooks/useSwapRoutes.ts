import useSWR from 'swr'
import { fetchSwapRoutes } from '@/lib/swap'
import type { SwapRoute, StellarAsset } from '@/types'
import { REVALIDATION_INTERVAL } from '@/constants'

export function useSwapRoutes(
  fromAsset: StellarAsset | null,
  toAsset: StellarAsset | null,
  fromAmount: number,
) {
  const key =
    fromAsset && toAsset && fromAmount > 0
      ? ['swap', fromAsset.code, toAsset.code, fromAmount]
      : null
  return useSWR<SwapRoute[]>(
    key,
    () => fetchSwapRoutes(fromAsset!, toAsset!, fromAmount),
    { refreshInterval: REVALIDATION_INTERVAL, revalidateOnFocus: false },
  )
}
