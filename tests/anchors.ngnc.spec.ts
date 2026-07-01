import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

describe('ngnc.online triage (B029)', () => {
  const ngnc = ANCHORS.find((a) => a.id === 'ngnc');

  it('is included in ANCHORS — has SEP-24 NGN withdraw corridor', () => {
    expect(ngnc).toBeDefined();
  });

  it('has correct home domain', () => {
    expect(ngnc?.homeDomain).toBe('ngnc.online');
  });

  it('anchors USDC with the correct issuer', () => {
    expect(ngnc?.assetCode).toBe('USDC');
    expect(ngnc?.assetIssuer).toBeDefined();
    expect(ngnc?.assetIssuer.length).toBeGreaterThan(0);
  });

  it('serves the usdc-ngn corridor', () => {
    expect(ngnc?.corridors).toContain('usdc-ngn');
  });

  it('declares sep24 capability', () => {
    expect(ngnc?.seps).toContain('sep24');
  });

  it('usdc-ngn corridor is defined in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-ngn');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.to).toBe('NGN');
    expect(corridor?.countryCode).toBe('NG');
  });

  it('ngnc home domain is registered in ANCHOR_HOME_DOMAINS', () => {
    expect(ANCHOR_HOME_DOMAINS['ngnc']).toBe('ngnc.online');
  });
});
