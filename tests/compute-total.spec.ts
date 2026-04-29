import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { computeTotalReceived } from '@/lib/utils'

describe('computeTotalReceived - Property-Based Tests', () => {
  // Generators with realistic constraints for fiat/crypto amounts
  const amountArb = fc.floatBetween(0, 1_000_000, { noNaN: true, noDefaultInfinity: true })
  const feeArb = fc.floatBetween(0, 100_000, { noNaN: true, noDefaultInfinity: true })
  const feePercentArb = fc.floatBetween(0, 100, { noNaN: true, noDefaultInfinity: true })
  const exchangeRateArb = fc.floatBetween(0.01, 1_000_000, { noNaN: true, noDefaultInfinity: true })

  it('total received is always non-negative', () => {
    fc.assert(
      fc.property(amountArb, feeArb, feePercentArb, exchangeRateArb, (amount, fee, feePercent, rate) => {
        const result = computeTotalReceived(amount, fee, feePercent, rate)
        expect(result).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 1000 }
    )
  })

  it('total received decreases as flat fee increases', () => {
    fc.assert(
      fc.property(
        amountArb,
        feeArb,
        feePercentArb,
        exchangeRateArb,
        (amount, baseFee, feePercent, rate) => {
          // Ensure baseFee is within a reasonable range relative to amount
          const normalizedFee = Math.min(baseFee, amount)
          const result1 = computeTotalReceived(amount, normalizedFee, feePercent, rate)
          const result2 = computeTotalReceived(amount, Math.max(0, normalizedFee - 0.01), feePercent, rate)
          // result1 should be <= result2 (higher fee = lower received)
          expect(result1).toBeLessThanOrEqual(result2 + 1e-10) // Small epsilon for floating point
        }
      ),
      { numRuns: 1000 }
    )
  })

  it('total received decreases as percent fee increases', () => {
    fc.assert(
      fc.property(
        amountArb,
        feeArb,
        feePercentArb,
        exchangeRateArb,
        (amount, fee, baseFeePercent, rate) => {
          // Ensure feePercent stays within [0, 100]
          const normalizedPercent = Math.min(baseFeePercent, 100)
          const result1 = computeTotalReceived(amount, fee, normalizedPercent, rate)
          const result2 = computeTotalReceived(amount, fee, Math.max(0, normalizedPercent - 0.01), rate)
          // result1 should be <= result2 (higher percent fee = lower received)
          expect(result1).toBeLessThanOrEqual(result2 + 1e-10) // Small epsilon for floating point
        }
      ),
      { numRuns: 1000 }
    )
  })

  it('total received increases with higher exchange rate', () => {
    fc.assert(
      fc.property(
        amountArb,
        feeArb,
        feePercentArb,
        exchangeRateArb,
        (amount, fee, feePercent, baseRate) => {
          const rate1 = baseRate
          const rate2 = baseRate + 1
          const result1 = computeTotalReceived(amount, fee, feePercent, rate1)
          const result2 = computeTotalReceived(amount, fee, feePercent, rate2)
          // Higher rate should yield higher or equal result (monotonically increasing)
          expect(result2).toBeGreaterThanOrEqual(result1)
        }
      ),
      { numRuns: 1000 }
    )
  })

  it('zero amount always returns zero', () => {
    fc.assert(
      fc.property(feeArb, feePercentArb, exchangeRateArb, (fee, feePercent, rate) => {
        const result = computeTotalReceived(0, fee, feePercent, rate)
        expect(result).toBe(0)
      }),
      { numRuns: 1000 }
    )
  })

  it('no fees returns amount multiplied by exchange rate', () => {
    fc.assert(
      fc.property(amountArb, exchangeRateArb, (amount, rate) => {
        const result = computeTotalReceived(amount, 0, 0, rate)
        expect(result).toBeCloseTo(amount * rate, 9)
      }),
      { numRuns: 1000 }
    )
  })

  it('flat fee cannot exceed received amount', () => {
    fc.assert(
      fc.property(
        amountArb,
        feeArb,
        feePercentArb,
        exchangeRateArb,
        (amount, fee, feePercent, rate) => {
          const result = computeTotalReceived(amount, fee, feePercent, rate)
          // The before-exchange result should not exceed amount * (1 - feePercent/100)
          const maxPossible = amount * (1 - feePercent / 100) * rate
          expect(result).toBeLessThanOrEqual(maxPossible + 1e-10)
        }
      ),
      { numRuns: 1000 }
    )
  })
})
