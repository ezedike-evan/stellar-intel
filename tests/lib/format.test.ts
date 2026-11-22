import { describe, it, expect } from 'vitest';
import { formatDeliveredAmount, formatSettleDuration } from '@/lib/format';

describe('formatDeliveredAmount', () => {
  it('formats NGN with currency style', () => {
    const result = formatDeliveredAmount('158000', 'NGN');
    expect(result).toContain('158');
    expect(result).toMatch(/NGN|₦/);
  });

  it('formats KES with currency style', () => {
    const result = formatDeliveredAmount('13500.50', 'KES');
    expect(result).toContain('13');
    expect(result).toMatch(/KES|KSh/);
  });

  it('formats BRL with currency style', () => {
    const result = formatDeliveredAmount('520.75', 'BRL');
    expect(result).toContain('520');
    expect(result).toMatch(/BRL|R\$/);
  });

  it('falls back gracefully for a non-numeric string', () => {
    const result = formatDeliveredAmount('N/A', 'NGN');
    expect(result).toBe('N/A NGN');
  });

  it('falls back gracefully for an empty string', () => {
    const result = formatDeliveredAmount('', 'KES');
    expect(result).toBe(' KES');
  });

  it('handles zero correctly', () => {
    const result = formatDeliveredAmount('0', 'MXN');
    expect(result).toContain('0');
    expect(result).toMatch(/MXN|\$/);
  });

  it('handles large numbers without throwing', () => {
    expect(() => formatDeliveredAmount('9999999.99', 'NGN')).not.toThrow();
  });
});

describe('formatSettleDuration', () => {
  it('formats seconds under 60', () => {
    expect(formatSettleDuration(5000)).toBe('5s');
    expect(formatSettleDuration(45000)).toBe('45s');
    expect(formatSettleDuration(0)).toBe('0s');
  });

  it('formats minutes under 60 with padded seconds', () => {
    expect(formatSettleDuration(65000)).toBe('1m 05s');
    expect(formatSettleDuration(120000)).toBe('2m 00s');
    expect(formatSettleDuration(3599000)).toBe('59m 59s');
  });

  it('formats hours with padded minutes', () => {
    expect(formatSettleDuration(3600000)).toBe('1h 00m');
    expect(formatSettleDuration(3665000)).toBe('1h 01m');
    expect(formatSettleDuration(7200000)).toBe('2h 00m');
  });

  it('handles invalid or negative durations with fallback', () => {
    expect(formatSettleDuration(-100)).toBe('—');
    expect(formatSettleDuration(NaN)).toBe('—');
    expect(formatSettleDuration(Infinity)).toBe('—');
  });
});
