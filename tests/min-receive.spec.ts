import { describe, it, expect } from 'vitest';
import { MIN_RECEIVE_TOLERANCE, checkMinReceive } from '@/lib/rate-ranking';
import { compareDecimals } from '@/lib/router/solve';

describe('MIN_RECEIVE_TOLERANCE', () => {
  it('is 2%', () => {
    expect(MIN_RECEIVE_TOLERANCE).toBe(0.02);
  });
});

describe('checkMinReceive', () => {
  it('has no floor when minReceive is missing, empty or not a decimal', () => {
    expect(checkMinReceive('100', undefined)).toEqual({ ok: true, reason: 'no_floor' });
    expect(checkMinReceive('100', '')).toEqual({ ok: true, reason: 'no_floor' });
    expect(checkMinReceive('100', 'abc')).toEqual({ ok: true, reason: 'no_floor' });
  });

  it('has no estimate when amountOut is missing, empty or not a decimal', () => {
    expect(checkMinReceive(undefined, '100')).toEqual({ ok: true, reason: 'no_estimate' });
    expect(checkMinReceive('', '100')).toEqual({ ok: true, reason: 'no_estimate' });
    expect(checkMinReceive('n/a', '100')).toEqual({ ok: true, reason: 'no_estimate' });
  });

  it('checks the floor before the estimate', () => {
    expect(checkMinReceive(undefined, undefined)).toEqual({ ok: true, reason: 'no_floor' });
  });

  it('is not ok when amountOut is below the floor, returning both figures', () => {
    expect(checkMinReceive('150000', '151743.20')).toEqual({
      ok: false,
      amountOut: '150000',
      minReceive: '151743.20',
    });
  });

  it('meets the floor when amountOut is above it', () => {
    expect(checkMinReceive('155000', '151743.20')).toEqual({ ok: true, reason: 'meets_floor' });
  });

  it('meets the floor when amountOut equals it, whatever the trailing zeros', () => {
    expect(checkMinReceive('151743.20', '151743.2')).toEqual({ ok: true, reason: 'meets_floor' });
    expect(checkMinReceive('100', '100.0000000')).toEqual({ ok: true, reason: 'meets_floor' });
  });

  it('compares at 7 decimal places without float error', () => {
    // One stroop (1e-7) below the floor must fail; a float compare of these
    // values would round them to the same number.
    expect(checkMinReceive('99999999.9999999', '100000000.0000000').ok).toBe(false);
    expect(checkMinReceive('100000000.0000000', '100000000.0000000').ok).toBe(true);
    expect(checkMinReceive('0.1000001', '0.1000000').ok).toBe(true);
  });

  it('accepts a leading-dot and trailing-dot decimal', () => {
    expect(checkMinReceive('.5', '0.5')).toEqual({ ok: true, reason: 'meets_floor' });
    expect(checkMinReceive('5.', '5')).toEqual({ ok: true, reason: 'meets_floor' });
  });
});

describe('compareDecimals (re-exported from the router)', () => {
  it('orders decimal strings exactly', () => {
    expect(compareDecimals('1.10', '1.1')).toBe(0);
    expect(compareDecimals('1.1', '1.2')).toBe(-1);
    expect(compareDecimals('2', '1.9999999')).toBe(1);
  });
});
