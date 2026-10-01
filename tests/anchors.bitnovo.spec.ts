import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

describe('bitnovo.com onboarding (ANC032)', () => {
  const bitnovo = ANCHORS.find((a) => a.id === 'bitnovo');

  it('is included in ANCHORS — live SEP-24 USDC→EUR anchor', () => {
    expect(bitnovo).toBeDefined();
  });

  it('uses the live SEP-24 home domain', () => {
    expect(bitnovo?.homeDomain).toBe('stellar.bitnovo.com');
    expect(bitnovo?.serviceDomain).toBeUndefined();
  });

  it('serves usdc-eur and flags it as unverified', () => {
    expect(bitnovo?.corridors).toContain('usdc-eur');
    expect(bitnovo?.unverifiedCorridors).toContain('usdc-eur');
  });

  it('registers USDC, not the off-TOML EUR rail asset, as the sold asset', () => {
    expect(bitnovo?.assetCode).toBe('USDC');
    expect(bitnovo?.assetCode).not.toBe('EUR');
  });

  it('advertises SEP-10 auth and SEP-24 transfer capability', () => {
    expect(bitnovo?.seps).toContain('sep10');
    expect(bitnovo?.seps).toContain('sep24');
  });

  it('usdc-eur corridor is defined in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-eur');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.to).toBe('EUR');
  });

  it('bitnovo home domain is registered in ANCHOR_HOME_DOMAINS', () => {
    expect(ANCHOR_HOME_DOMAINS['bitnovo']).toBe('stellar.bitnovo.com');
  });
});
