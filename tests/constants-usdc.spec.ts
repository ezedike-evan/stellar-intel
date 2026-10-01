import { describe, it, expect } from 'vitest';
import { USDC_ASSET as INDEX_USDC_ASSET } from '@/constants';
import { USDC_ASSET as ANCHORS_USDC_ASSET } from '@/constants/anchors';
import { USDC_ISSUER } from '@/lib/config';

describe('USDC_ASSET canonical export (#1272)', () => {
  it('re-exports the exact same USDC_ASSET object from @/constants as @/constants/anchors', () => {
    expect(INDEX_USDC_ASSET).toBe(ANCHORS_USDC_ASSET);
  });

  it('has issuer equal to USDC_ISSUER from @/lib/config', () => {
    expect(INDEX_USDC_ASSET.issuer).toBe(USDC_ISSUER);
    expect(ANCHORS_USDC_ASSET.issuer).toBe(USDC_ISSUER);
  });

  it('has code USDC and name USD Coin', () => {
    expect(INDEX_USDC_ASSET.code).toBe('USDC');
    expect(INDEX_USDC_ASSET.name).toBe('USD Coin');
  });
});
