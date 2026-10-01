import { describe, it, expect } from 'vitest';
import { getCorridorAsset, sep38AssetId } from '@/lib/stellar/anchors';
import { ANCHORS } from '@/constants/anchors';
import { USDC_ISSUER } from '@/lib/config';

const NT_TOKENS_ISSUER = ANCHORS.find((a) => a.id === 'ntokens')?.assetIssuer;

describe('getCorridorAsset', () => {
  it('returns USDC, its issuer, and the USD peg for usdc-ngn', () => {
    expect(getCorridorAsset('usdc-ngn')).toEqual({
      code: 'USDC',
      issuer: USDC_ISSUER,
      peg: 'USD',
    });
  });

  it('returns the nTokens issuer and the BRL peg for brl-brl', () => {
    expect(getCorridorAsset('brl-brl')).toEqual({
      code: 'BRL',
      issuer: NT_TOKENS_ISSUER,
      peg: 'BRL',
    });
  });

  it('throws the Unknown corridor error for an unknown id', () => {
    expect(() => getCorridorAsset('usdc-xyz')).toThrow(/Unknown corridor.*usdc-xyz/);
  });
});

describe('sep38AssetId', () => {
  it('maps native XLM to stellar:native', () => {
    expect(sep38AssetId({ code: 'XLM', issuer: null })).toBe('stellar:native');
  });

  it('formats a coded asset as stellar:CODE:ISSUER', () => {
    expect(sep38AssetId({ code: 'USDC', issuer: USDC_ISSUER })).toBe(`stellar:USDC:${USDC_ISSUER}`);
  });
});
