import { describe, it, expect } from 'vitest'
import {
  computeTotalReceived,
  formatCurrency,
  formatRate,
  truncatePublicKey,
  isExpired,
  timeAgo,
} from '@/lib/utils'

describe('computeTotalReceived', () => {
  it('applies flat fee then exchange rate', () => {
    // 100 - 2 = 98 USDC remaining; 98 * 1580 = 154840
    expect(computeTotalReceived(100, 2, 0, 1580)).toBe(98 * 1580)
  })

  it('applies percent fee (in percentage points) then exchange rate', () => {
    // 1% fee: 100 * (1 - 1/100) * 1580 = 99 * 1580
    expect(computeTotalReceived(100, 0, 1, 1580)).toBe(99 * 1580)
  })

  it('returns 0 when amount is 0', () => {
    expect(computeTotalReceived(0, 2, 0, 1580)).toBe(0)
  })

  it('applies both flat and percent fee', () => {
    // (100 - 2) * (1 - 1/100) * 1580 = 98 * 0.99 * 1580
    expect(computeTotalReceived(100, 2, 1, 1580)).toBeCloseTo(98 * 0.99 * 1580)
  })
})

describe('formatCurrency', () => {
  it('returns a non-empty string for NGN', () => {
    const result = formatCurrency(1580.25, 'NGN')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('1,580')
  })

  it('returns a non-empty string for USD', () => {
    const result = formatCurrency(100, 'USD')
    expect(result).toContain('100')
  })

  it('falls back gracefully for an unrecognised currency code', () => {
    const result = formatCurrency(50, 'XYZ')
    expect(result).toContain('50')
  })
})

describe('formatRate', () => {
  it('formats a rate string correctly', () => {
    expect(formatRate(1580, 'USDC', 'NGN')).toBe('1 USDC = 1,580 NGN')
  })

  it('includes decimal places for fractional rates', () => {
    const result = formatRate(1.5025, 'USDC', 'EUR')
    expect(result).toContain('USDC')
    expect(result).toContain('EUR')
  })
})

describe('truncatePublicKey', () => {
  it('shows first 4 and last 4 chars of a 56-char key', () => {
    const key = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRST'
    const result = truncatePublicKey(key)
    expect(result).toBe('GABC...QRST')
    expect(result).toContain('...')
  })

  it('returns the key unchanged if it is 8 chars or fewer', () => {
    expect(truncatePublicKey('GABCWXYZ')).toBe('GABCWXYZ')
  })
})

describe('isExpired', () => {
  it('returns true for a date in the past', () => {
    const past = new Date(Date.now() - 1000)
    expect(isExpired(past)).toBe(true)
  })

  it('returns false for a date in the future', () => {
    const future = new Date(Date.now() + 60_000)
    expect(isExpired(future)).toBe(false)
  })
})

describe('timeAgo', () => {
  it('returns "just now" for a very recent date', () => {
    expect(timeAgo(new Date())).toBe('just now')
  })

  it('returns minutes for a date a few minutes ago', () => {
    const d = new Date(Date.now() - 3 * 60 * 1000)
    expect(timeAgo(d)).toBe('3 minutes ago')
  })

  it('returns hours for a date hours ago', () => {
    const d = new Date(Date.now() - 2 * 60 * 60 * 1000)
    expect(timeAgo(d)).toBe('2 hours ago')
  })
})
