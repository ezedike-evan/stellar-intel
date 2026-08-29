import { describe, it, expect } from 'vitest';
import {
  STELLAR_PUBKEY_PATTERN,
  AMOUNT_PATTERN,
  AMOUNT_7DP_PATTERN,
  SIGNED_AMOUNT_PATTERN,
} from '@/lib/patterns';

describe('STELLAR_PUBKEY_PATTERN', () => {
  it('accepts a valid base32 Stellar public key', () => {
    expect(
      STELLAR_PUBKEY_PATTERN.test('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
    ).toBe(true);
  });

  it('rejects keys containing non-base32 digits 0, 1, 8, 9', () => {
    for (const bad of ['0', '1', '8', '9']) {
      const key = 'G' + bad.repeat(55);
      expect(STELLAR_PUBKEY_PATTERN.test(key)).toBe(false);
    }
  });

  it('rejects keys of the wrong length or prefix', () => {
    expect(
      STELLAR_PUBKEY_PATTERN.test('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZV')
    ).toBe(false); // 54 chars
    expect(
      STELLAR_PUBKEY_PATTERN.test('MA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
    ).toBe(false); // wrong prefix
  });
});

describe('amount patterns', () => {
  it('AMOUNT_PATTERN accepts positive decimals, rejects signs and empties', () => {
    expect(AMOUNT_PATTERN.test('100')).toBe(true);
    expect(AMOUNT_PATTERN.test('100.5')).toBe(true);
    expect(AMOUNT_PATTERN.test('-1')).toBe(false);
    expect(AMOUNT_PATTERN.test('')).toBe(false);
  });

  it('AMOUNT_7DP_PATTERN caps fractional digits at 7', () => {
    expect(AMOUNT_7DP_PATTERN.test('1.1234567')).toBe(true);
    expect(AMOUNT_7DP_PATTERN.test('1.12345678')).toBe(false);
  });

  it('SIGNED_AMOUNT_PATTERN allows an optional leading minus', () => {
    expect(SIGNED_AMOUNT_PATTERN.test('-1.5')).toBe(true);
    expect(SIGNED_AMOUNT_PATTERN.test('2.25')).toBe(true);
  });
});
