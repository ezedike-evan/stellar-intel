import { describe, it, expect } from 'vitest'
import { enforceFeeBudget, filterAnchorRatesByFeeBudget, FeeBudgetExceededError } from '@/lib/router/solve'
import type { AnchorRate } from '@/types'

const MOCK_RATES: AnchorRate[] = [
  {
    anchorId: 'cheap',
    anchorName: 'Cheap Anchor',
    corridorId: 'usdc-ngn',
    fee: 5,
    feeType: 'flat',
    exchangeRate: 1580,
    totalReceived: 95 * 1580,
    source: 'sep24-fee',
    updatedAt: new Date(),
  },
  {
    anchorId: 'expensive',
    anchorName: 'Expensive Anchor',
    corridorId: 'usdc-ngn',
    fee: 15,
    feeType: 'flat',
    exchangeRate: 1580,
    totalReceived: 85 * 1580,
    source: 'sep24-fee',
    updatedAt: new Date(),
  },
]

describe('filterAnchorRatesByFeeBudget', () => {
  it('keeps only routes whose fee is within the configured percentage of the amount', () => {
    const filtered = filterAnchorRatesByFeeBudget(MOCK_RATES, '100', 10)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].anchorId).toBe('cheap')
  })

  it('returns an empty array when no routes satisfy the budget', () => {
    const filtered = filterAnchorRatesByFeeBudget(MOCK_RATES, '100', 1)

    expect(filtered).toHaveLength(0)
  })
})

describe('enforceFeeBudget', () => {
  it('returns routes when at least one route satisfies the budget', () => {
    const filtered = enforceFeeBudget(MOCK_RATES, '100', 10)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].anchorId).toBe('cheap')
  })

  it('throws FeeBudgetExceededError when no route is within budget', () => {
    expect(() => enforceFeeBudget(MOCK_RATES, '100', 1)).toThrow(FeeBudgetExceededError)
    expect(() => enforceFeeBudget(MOCK_RATES, '100', 1)).toThrow(
      /No route was found with fees less than or equal to 1% of 100/
    )
  })
})
