import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { computeRateComparison } from '@/lib/stellar/sep24'
import type { AnchorRate } from '@/types'

/**
 * Property tests for rate ranking invariants.
 *
 * Tests the computeRateComparison function to ensure:
 * - Sort stability: same input yields same output
 * - Monotonicity: the selected bestRateId always has the highest totalReceived
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockRate(
  anchorId: string,
  totalReceived: number,
  overrides?: Partial<AnchorRate>
): AnchorRate {
  return {
    anchorId,
    anchorName: `Anchor ${anchorId}`,
    corridorId: 'usdc-ngn',
    fee: 2.5,
    feeType: 'flat',
    exchangeRate: 1580,
    totalReceived,
    source: 'sep24-fee',
    updatedAt: new Date(),
    ...overrides,
  }
}

// ─── Sort stability ───────────────────────────────────────────────────────────

describe('computeRateComparison — sort stability', () => {
  it('returns the same bestRateId given identical inputs', () => {
    const rates = [
      createMockRate('anchor-a', 100),
      createMockRate('anchor-b', 150),
      createMockRate('anchor-c', 120),
    ]

    const results = rates.map((r): PromiseFulfilledResult<AnchorRate> => ({
      status: 'fulfilled',
      value: r,
    }))

    const comparison1 = computeRateComparison(results, 'usdc-ngn')
    const comparison2 = computeRateComparison(results, 'usdc-ngn')

    expect(comparison1.bestRateId).toBe(comparison2.bestRateId)
    expect(comparison1.bestRateId).toBe('anchor-b')
  })

  it('deterministically selects the highest totalReceived across multiple calls', () => {
    const rate1 = createMockRate('anchor-a', 100)
    const rate2 = createMockRate('anchor-b', 200)
    const rate3 = createMockRate('anchor-c', 150)

    for (let i = 0; i < 5; i++) {
      const results = [rate1, rate2, rate3].map((r): PromiseFulfilledResult<AnchorRate> => ({
        status: 'fulfilled',
        value: r,
      }))

      const comparison = computeRateComparison(results, 'usdc-ngn')
      expect(comparison.bestRateId).toBe('anchor-b')
    }
  })
})

// ─── Monotonicity ─────────────────────────────────────────────────────────────

describe('computeRateComparison — monotonicity', () => {
  it('ensures bestRateId has the highest totalReceived value', () => {
    const rates = [
      createMockRate('anchor-a', 500),
      createMockRate('anchor-b', 1200),
      createMockRate('anchor-c', 800),
      createMockRate('anchor-d', 650),
    ]

    const results = rates.map((r): PromiseFulfilledResult<AnchorRate> => ({
      status: 'fulfilled',
      value: r,
    }))

    const comparison = computeRateComparison(results, 'usdc-ngn')

    const bestRate = comparison.rates.find((r) => r.anchorId === comparison.bestRateId)
    expect(bestRate).toBeDefined()
    expect(bestRate?.totalReceived).toBe(1200)

    // Verify no other rate is higher
    comparison.rates.forEach((rate) => {
      expect(rate.totalReceived).toBeLessThanOrEqual(bestRate!.totalReceived)
    })
  })

  it('handles a single rate correctly', () => {
    const rate = createMockRate('anchor-a', 100)
    const results: PromiseFulfilledResult<AnchorRate>[] = [
      { status: 'fulfilled', value: rate },
    ]

    const comparison = computeRateComparison(results, 'usdc-ngn')
    expect(comparison.bestRateId).toBe('anchor-a')
  })

  it('preserves all provided rates in the output', () => {
    const rates = [
      createMockRate('anchor-a', 100),
      createMockRate('anchor-b', 200),
      createMockRate('anchor-c', 150),
    ]

    const results = rates.map((r): PromiseFulfilledResult<AnchorRate> => ({
      status: 'fulfilled',
      value: r,
    }))

    const comparison = computeRateComparison(results, 'usdc-ngn')
    expect(comparison.rates).toHaveLength(3)
    expect(comparison.rates.map((r) => r.anchorId)).toContain('anchor-a')
    expect(comparison.rates.map((r) => r.anchorId)).toContain('anchor-b')
    expect(comparison.rates.map((r) => r.anchorId)).toContain('anchor-c')
  })
})

// ─── Empty / error handling ───────────────────────────────────────────────────

describe('computeRateComparison — edge cases', () => {
  it('returns empty rates and empty bestRateId when all results fail', () => {
    const results: PromiseSettledResult<AnchorRate>[] = [
      { status: 'rejected', reason: new Error('Network error') },
      { status: 'rejected', reason: new Error('Timeout') },
    ]

    const comparison = computeRateComparison(results, 'usdc-ngn')
    expect(comparison.rates).toHaveLength(0)
    expect(comparison.bestRateId).toBe('')
  })

  it('ignores rejected results and only considers fulfilled ones', () => {
    const rate1 = createMockRate('anchor-a', 100)
    const rate2 = createMockRate('anchor-b', 300)

    const results: PromiseSettledResult<AnchorRate>[] = [
      { status: 'fulfilled', value: rate1 },
      { status: 'rejected', reason: new Error('Network error') },
      { status: 'fulfilled', value: rate2 },
    ]

    const comparison = computeRateComparison(results, 'usdc-ngn')
    expect(comparison.rates).toHaveLength(2)
    expect(comparison.bestRateId).toBe('anchor-b')
  })

  it('correctly identifies best rate even when it appears last', () => {
    const rates = [
      createMockRate('anchor-a', 100),
      createMockRate('anchor-b', 50),
      createMockRate('anchor-c', 999),
    ]

    const results = rates.map((r): PromiseFulfilledResult<AnchorRate> => ({
      status: 'fulfilled',
      value: r,
    }))

    const comparison = computeRateComparison(results, 'usdc-ngn')
    expect(comparison.bestRateId).toBe('anchor-c')
  })

  it('correctly identifies best rate even when it appears first', () => {
    const rates = [
      createMockRate('anchor-a', 999),
      createMockRate('anchor-b', 100),
      createMockRate('anchor-c', 50),
    ]

    const results = rates.map((r): PromiseFulfilledResult<AnchorRate> => ({
      status: 'fulfilled',
      value: r,
    }))

    const comparison = computeRateComparison(results, 'usdc-ngn')
    expect(comparison.bestRateId).toBe('anchor-a')
  })
})

// ─── Property-based tests with fast-check ─────────────────────────────────────

describe('computeRateComparison — property tests', () => {
  it('bestRateId always has the maximum totalReceived (for non-empty arrays)', () => {
    fc.assert(
      fc.property(fc.array(fc.float({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }), { minLength: 1 }), (totalReceivedValues) => {
        const rates = totalReceivedValues.map((total, idx) =>
          createMockRate(`anchor-${idx}`, total)
        )

        const results = rates.map((r): PromiseFulfilledResult<AnchorRate> => ({
          status: 'fulfilled',
          value: r,
        }))

        const comparison = computeRateComparison(results, 'usdc-ngn')
        const bestRate = comparison.rates.find((r) => r.anchorId === comparison.bestRateId)

        // The best rate must exist and have the maximum totalReceived
        expect(bestRate).toBeDefined()
        expect(bestRate?.totalReceived).toBe(Math.max(...totalReceivedValues))
      })
    )
  })

  it('reordering inputs does not change bestRateId', () => {
    fc.assert(
      fc.property(fc.array(fc.float({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }), { minLength: 1 }), (totalReceivedValues) => {
        const rates1 = totalReceivedValues.map((total, idx) =>
          createMockRate(`anchor-${idx}`, total)
        )
        const rates2 = [...rates1].reverse()

        const results1 = rates1.map((r): PromiseFulfilledResult<AnchorRate> => ({
          status: 'fulfilled',
          value: r,
        }))
        const results2 = rates2.map((r): PromiseFulfilledResult<AnchorRate> => ({
          status: 'fulfilled',
          value: r,
        }))

        const comparison1 = computeRateComparison(results1, 'usdc-ngn')
        const comparison2 = computeRateComparison(results2, 'usdc-ngn')

        expect(comparison1.bestRateId).toBe(comparison2.bestRateId)
      })
    )
  })

  it('output rate array contains exactly as many items as non-rejected inputs', () => {
    fc.assert(
      fc.property(fc.array(fc.float({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }), { minLength: 1 }), (totalReceivedValues) => {
        const rates = totalReceivedValues.map((total, idx) =>
          createMockRate(`anchor-${idx}`, total)
        )

        const results = rates.map((r): PromiseFulfilledResult<AnchorRate> => ({
          status: 'fulfilled',
          value: r,
        }))

        const comparison = computeRateComparison(results, 'usdc-ngn')
        expect(comparison.rates).toHaveLength(totalReceivedValues.length)
      })
    )
  })
})
