import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

describe('finclusive.com onboarding (ANC034)', () => {
  const finclusive = ANCHORS.find((a) => a.id === 'finclusive');

  it('is included in ANCHORS — live SEP-24 USDC anchor', () => {
    expect(finclusive).toBeDefined();
  });

  it('uses the live home domain for SEP endpoint discovery', () => {
    expect(finclusive?.homeDomain).toBe('finclusive.com');
    expect(finclusive?.serviceDomain).toBeUndefined();
  });

  it('serves usdc-usd and flags it as unverified', () => {
    expect(finclusive?.corridors).toContain('usdc-usd');
    expect(finclusive?.unverifiedCorridors).toContain('usdc-usd');
  });

  it('anchors USDC with the canonical issuer', () => {
    expect(finclusive?.assetCode).toBe('USDC');
  });

  it('advertises SEP-6, SEP-10, SEP-24 and SEP-31 capability', () => {
    expect(finclusive?.seps).toContain('sep6');
    expect(finclusive?.seps).toContain('sep10');
    expect(finclusive?.seps).toContain('sep24');
    expect(finclusive?.seps).toContain('sep31');
  });

  it('usdc-usd corridor is defined in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-usd');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.to).toBe('USD');
    expect(corridor?.countryCode).toBe('US');
  });

  it('finclusive home domain is registered in ANCHOR_HOME_DOMAINS', () => {
    expect(ANCHOR_HOME_DOMAINS['finclusive']).toBe('finclusive.com');
  });
});
