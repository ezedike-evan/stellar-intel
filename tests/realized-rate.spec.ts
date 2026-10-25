import { describe, expect, it } from 'vitest';
import { quotedAllInRate, realizedRate, realizedRateFromSep6 } from '@/lib/stellar/realized-rate';
import type { Sep6Transaction } from '@/lib/stellar/sep6';

describe('realizedRate', () => {
  it('computes allInRate, netRate, and fee for normal withdraw numbers', () => {
    const result = realizedRate({
      amountIn: '100.00',
      amountOut: '155000.00',
      amountFee: '2.00',
    });

    expect(result).toEqual({
      allInRate: '1550.00000000',
      netRate: (155000 / 98).toFixed(8),
      fee: '2.00',
    });
  });

  it('returns netRate and fee as null when amountFee is omitted', () => {
    const result = realizedRate({
      amountIn: '50',
      amountOut: '79000',
    });

    expect(result).toEqual({
      allInRate: '1580.00000000',
      netRate: null,
      fee: null,
    });
  });

  it('sets netRate to null when amountFee is equal to or larger than amountIn', () => {
    const equalFee = realizedRate({
      amountIn: '100',
      amountOut: '150000',
      amountFee: '100',
    });
    expect(equalFee).toEqual({
      allInRate: '1500.00000000',
      netRate: null,
      fee: '100',
    });

    const largerFee = realizedRate({
      amountIn: '100',
      amountOut: '150000',
      amountFee: '125.5',
    });
    expect(largerFee).toEqual({
      allInRate: '1500.00000000',
      netRate: null,
      fee: '125.5',
    });
  });

  it('returns null when amountIn or amountOut is missing, non-numeric, or <= 0', () => {
    expect(realizedRate({})).toBeNull();
    expect(realizedRate({ amountIn: '100' })).toBeNull();
    expect(realizedRate({ amountOut: '150000' })).toBeNull();
    expect(realizedRate({ amountIn: '', amountOut: '150000' })).toBeNull();
    expect(realizedRate({ amountIn: '   ', amountOut: '150000' })).toBeNull();
    expect(realizedRate({ amountIn: 'abc', amountOut: '150000' })).toBeNull();
    expect(realizedRate({ amountIn: '100', amountOut: 'not-a-number' })).toBeNull();
    expect(realizedRate({ amountIn: '0', amountOut: '150000' })).toBeNull();
    expect(realizedRate({ amountIn: '-10', amountOut: '150000' })).toBeNull();
    expect(realizedRate({ amountIn: '100', amountOut: '0' })).toBeNull();
    expect(realizedRate({ amountIn: '100', amountOut: '-500' })).toBeNull();
  });

  it('handles strings with exponent notation accurately', () => {
    const result = realizedRate({
      amountIn: '1e2',
      amountOut: '1.58e5',
      amountFee: '5e0',
    });

    expect(result).toEqual({
      allInRate: '1580.00000000',
      netRate: (158000 / 95).toFixed(8),
      fee: '5e0',
    });

    const smallExponent = realizedRate({
      amountIn: '2.5e-1',
      amountOut: '3.75e2',
    });

    expect(smallExponent).toEqual({
      allInRate: '1500.00000000',
      netRate: null,
      fee: null,
    });
  });

  it('ignores non-numeric or negative amountFee while preserving allInRate', () => {
    expect(
      realizedRate({
        amountIn: '100',
        amountOut: '150000',
        amountFee: 'invalid',
      })
    ).toEqual({
      allInRate: '1500.00000000',
      netRate: null,
      fee: null,
    });

    expect(
      realizedRate({
        amountIn: '100',
        amountOut: '150000',
        amountFee: '-1',
      })
    ).toEqual({
      allInRate: '1500.00000000',
      netRate: null,
      fee: null,
    });
  });
});

describe('realizedRateFromSep6', () => {
  it('maps a Sep6Transaction record to realizedRate', () => {
    const sep6Tx: Sep6Transaction = {
      id: 'sep6-tx-001',
      status: 'completed',
      normalizedStatus: 'completed',
      updatedAt: new Date('2026-10-20T00:00:00Z'),
      amountIn: '200',
      amountOut: '310000',
      amountFee: '4',
    };

    expect(realizedRateFromSep6(sep6Tx)).toEqual({
      allInRate: '1550.00000000',
      netRate: (310000 / 196).toFixed(8),
      fee: '4',
    });
  });

  it('maps raw snake_case SEP-6 transaction fields to realizedRate', () => {
    const rawSep6 = {
      amount_in: '50',
      amount_out: '75000',
      amount_fee: '1',
    };

    expect(realizedRateFromSep6(rawSep6)).toEqual({
      allInRate: '1500.00000000',
      netRate: (75000 / 49).toFixed(8),
      fee: '1',
    });
  });
});

describe('quotedAllInRate (#1498)', () => {
  it('quotes totalReceived over the amount sent, to 8 decimals', () => {
    // 100 USDC shown as 155,000 NGN after fees: 1550 per USDC all-in.
    expect(quotedAllInRate({ totalReceived: 155000, exchangeRate: 1600 }, '100')).toBe(
      '1550.00000000'
    );
  });

  it('is comparable with the realized all-in rate of an exact delivery', () => {
    const quoted = quotedAllInRate({ totalReceived: 97.5, exchangeRate: 1 }, '100');
    const landed = realizedRate({ amountIn: '100', amountOut: '97.5' })!.allInRate;
    expect(quoted).toBe(landed);
  });

  it('is not the pre-fee exchange rate', () => {
    expect(quotedAllInRate({ totalReceived: 97.5, exchangeRate: 1 }, '100')).not.toBe('1');
  });

  it('falls back to the exchange rate with no total', () => {
    expect(quotedAllInRate({ totalReceived: null, exchangeRate: 1550.5 }, '100')).toBe('1550.5');
  });

  it.each(['0', '-5', 'abc', ''])('falls back to the exchange rate for the amount "%s"', (a) => {
    expect(quotedAllInRate({ totalReceived: 100, exchangeRate: 2 }, a)).toBe('2');
  });

  it('is null when neither is available', () => {
    expect(quotedAllInRate({ totalReceived: null, exchangeRate: null }, '100')).toBeNull();
  });
});
