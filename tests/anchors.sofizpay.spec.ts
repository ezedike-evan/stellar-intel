import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

describe('sofizpay.com onboarding (ANC033)', () => {
  const sofizpay = ANCHORS.find((a) => a.id === 'sofizpay');

  it('is included in ANCHORS — live SEP-24 DZT anchor', () => {
    expect(sofizpay).toBeDefined();
  });

  it('uses the live SEP-24 home domain', () => {
    expect(sofizpay?.homeDomain).toBe('sofizpay.com');
    expect(sofizpay?.serviceDomain).toBeUndefined();
  });

  it('serves the dzt-dzd corridor', () => {
    expect(sofizpay?.corridors).toContain('dzt-dzd');
  });

  it('registers DZT with the TOML issuer, not a look-alike', () => {
    expect(sofizpay?.assetCode).toBe('DZT');
    expect(sofizpay?.assetIssuer).toBe('GCAZI7YBLIDJWIVEL7ETNAZGPP3LC24NO6KAOBWZHUERXQ7M5BC52DLV');
  });

  it('advertises SEP-6, SEP-10 and SEP-24 transfer capability', () => {
    expect(sofizpay?.seps).toContain('sep6');
    expect(sofizpay?.seps).toContain('sep10');
    expect(sofizpay?.seps).toContain('sep24');
  });

  it('dzt-dzd corridor is defined with countryCode DZ', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'dzt-dzd');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('DZT');
    expect(corridor?.to).toBe('DZD');
    expect(corridor?.countryCode).toBe('DZ');
    expect(corridor?.countryName).toBe('Algeria');
  });

  it('sofizpay home domain is registered in ANCHOR_HOME_DOMAINS', () => {
    expect(ANCHOR_HOME_DOMAINS['sofizpay']).toBe('sofizpay.com');
  });
});
