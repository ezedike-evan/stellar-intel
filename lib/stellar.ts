import { Horizon } from '@stellar/stellar-sdk'
import { HORIZON_URL } from '@/constants'

export const horizonServer = new Horizon.Server(HORIZON_URL)

export function formatAmount(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(amount)
}

export function formatRate(rate: number, currencySymbol: string): string {
  return `${currencySymbol}${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(rate)}`
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatTVL(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

export function computeTotalReceived(
  amount: number,
  fee: number,
  feePercent: number,
  exchangeRate: number,
): number {
  const afterFees = amount - fee - amount * feePercent
  return afterFees * exchangeRate
}
