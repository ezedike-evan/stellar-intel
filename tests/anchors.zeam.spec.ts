import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

describe('zeam.money triage (B032)', () => {
  const zeam = ANCHORS.find((a) => a.id === 'zeam');

  it('is included in ANCHORS — has SEP-24 fiat ZAR corridor', () => {
    expect(zeam).toBeDefined();
  });

  it('has correct home domain and service domain', () => {
    expect(zeam?.homeDomain).toBe('zeam.money');
    expect(zeam?.serviceDomain).toBe('anchor.zeam.money');
  });

  it('anchors USDC with the correct issuer', () => {
    expect(zeam?.assetCode).toBe('USDC');
  });

  it('serves the usdc-zar corridor', () => {
    expect(zeam?.corridors).toContain('usdc-zar');
  });

  it('usdc-zar corridor is defined in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-zar');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.to).toBe('ZAR');
    expect(corridor?.countryCode).toBe('ZA');
  });

  it('zeam home domain is registered in ANCHOR_HOME_DOMAINS', () => {
    expect(ANCHOR_HOME_DOMAINS['zeam']).toBe('zeam.money');
  });
});
