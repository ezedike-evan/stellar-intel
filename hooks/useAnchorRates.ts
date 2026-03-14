import useSWR from 'swr'
import { fetchAnchorRates, fetchOnrampRates } from '@/lib/anchors'
import type { AnchorRate } from '@/types'
import { REVALIDATION_INTERVAL } from '@/constants'

export function useAnchorRates(country: string, currency: string, amount: number) {
  const key = country && currency && amount > 0 ? ['offramp', country, currency, amount] : null
  return useSWR<AnchorRate[]>(key, () => fetchAnchorRates(country, currency, amount), {
    refreshInterval: REVALIDATION_INTERVAL,
    revalidateOnFocus: false,
  })
}

export function useOnrampRates(country: string, currency: string, localAmount: number) {
  const key =
    country && currency && localAmount > 0 ? ['onramp', country, currency, localAmount] : null
  return useSWR<AnchorRate[]>(key, () => fetchOnrampRates(country, currency, localAmount), {
    refreshInterval: REVALIDATION_INTERVAL,
    revalidateOnFocus: false,
  })
}
