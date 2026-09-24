import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

describe('ngnc.online triage (B029, updated #1275)', () => {
  const ngnc = ANCHORS.find((a) => a.id === 'ngnc');

  it('is included in ANCHORS — has SEP-24 NGN withdraw corridor', () => {
    expect(ngnc).toBeDefined();
  });

  it('has correct home domain', () => {
    expect(ngnc?.homeDomain).toBe('ngnc.online');
  });

  it('anchors NGNC with the correct issuer', () => {
    expect(ngnc?.assetCode).toBe('NGNC');
    expect(ngnc?.assetIssuer).toBe('GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6');
  });

  it('serves the ngnc-ngn corridor', () => {
    expect(ngnc?.corridors).toContain('ngnc-ngn');
  });

  it('declares sep10 and sep24 capabilities', () => {
    expect(ngnc?.seps).toContain('sep10');
    expect(ngnc?.seps).toContain('sep24');
  });

  it('ngnc-ngn corridor is defined in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'ngnc-ngn');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('NGNC');
    expect(corridor?.to).toBe('NGN');
    expect(corridor?.countryCode).toBe('NG');
  });

  it('ngnc home domain is registered in ANCHOR_HOME_DOMAINS', () => {
    expect(ANCHOR_HOME_DOMAINS['ngnc']).toBe('ngnc.online');
  });
});
