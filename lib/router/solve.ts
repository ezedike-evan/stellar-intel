import { env } from '../env'
import type { AnchorRate } from '../../types'

export const TypedError = {
  FeeBudgetExceeded: 'FeeBudgetExceeded',
} as const

export type TypedError = (typeof TypedError)[keyof typeof TypedError]

export class FeeBudgetExceededError extends Error {
  readonly type = TypedError.FeeBudgetExceeded
  readonly amount: number
  readonly feeBudgetPct: number

  constructor(amount: number, feeBudgetPct: number | undefined = env.NEXT_PUBLIC_FEE_BUDGET_PCT) {
    super(
      `No route was found with fees less than or equal to ${feeBudgetPct}% of ${amount}`
    )
    this.name = TypedError.FeeBudgetExceeded
    this.amount = amount
    this.feeBudgetPct = feeBudgetPct
  }
}

function parseAmount(amount: string | number): number {
  const value = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid amount: ${amount}`)
  }
  return value
}

export function getMaxFeeForAmount(
  amount: string | number,
  feeBudgetPct: number = env.NEXT_PUBLIC_FEE_BUDGET_PCT
): number {
  const amountNum = parseAmount(amount)
  return amountNum * (feeBudgetPct / 100)
}

export function filterAnchorRatesByFeeBudget(
  rates: AnchorRate[],
  amount: string | number,
  feeBudgetPct: number = env.NEXT_PUBLIC_FEE_BUDGET_PCT
): AnchorRate[] {
  const amountNum = parseAmount(amount)
  const maxFee = getMaxFeeForAmount(amountNum, feeBudgetPct)

  return rates.filter((rate) => rate.fee !== null && rate.fee <= maxFee)
}

export function enforceFeeBudget(
  rates: AnchorRate[],
  amount: string | number,
  feeBudgetPct: number = env.NEXT_PUBLIC_FEE_BUDGET_PCT
): AnchorRate[] {
  const filtered = filterAnchorRatesByFeeBudget(rates, amount, feeBudgetPct)

  if (filtered.length === 0) {
    throw new FeeBudgetExceededError(parseAmount(amount), feeBudgetPct)
  }

  return filtered
}
