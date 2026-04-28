import { describe, it, expect } from 'vitest'
import { formatDeliveredAmount } from '@/lib/format'

describe('formatDeliveredAmount', () => {
  it('formats NGN with currency style', () => {
    const result = formatDeliveredAmount('158000', 'NGN')
    expect(result).toContain('158')
    expect(result).toMatch(/NGN|₦/)
  })

  it('formats KES with currency style', () => {
    const result = formatDeliveredAmount('13500.50', 'KES')
    expect(result).toContain('13')
    expect(result).toMatch(/KES|KSh/)
  })

  it('formats BRL with currency style', () => {
    const result = formatDeliveredAmount('520.75', 'BRL')
    expect(result).toContain('520')
    expect(result).toMatch(/BRL|R\$/)
  })

  it('falls back gracefully for a non-numeric string', () => {
    const result = formatDeliveredAmount('N/A', 'NGN')
    expect(result).toBe('N/A NGN')
  })

  it('falls back gracefully for an empty string', () => {
    const result = formatDeliveredAmount('', 'KES')
    expect(result).toBe(' KES')
  })

  it('handles zero correctly', () => {
    const result = formatDeliveredAmount('0', 'MXN')
    expect(result).toContain('0')
    expect(result).toMatch(/MXN|\$/)
  })

  it('handles large numbers without throwing', () => {
    expect(() => formatDeliveredAmount('9999999.99', 'NGN')).not.toThrow()
  })
})
