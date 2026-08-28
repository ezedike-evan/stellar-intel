import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

describe('ntokens.com triage (B030)', () => {
  const ntokens = ANCHORS.find((a) => a.id === 'ntokens');

  it('is included in ANCHORS — has SEP-24 fiat BRL withdraw corridor', () => {
    expect(ntokens).toBeDefined();
  });

  it('has correct home domain and service domain', () => {
    expect(ntokens?.homeDomain).toBe('ntokens.com');
    expect(ntokens?.serviceDomain).toBe('ntokens-box.bpventures.us');
  });

  it('anchors BRL with the correct issuer', () => {
    expect(ntokens?.assetCode).toBe('BRL');
    expect(ntokens?.assetIssuer).toBe('GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP');
  });

  it('serves the brl-brl corridor', () => {
    expect(ntokens?.corridors).toContain('brl-brl');
  });

  it('brl-brl corridor is defined in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'brl-brl');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('BRL');
    expect(corridor?.to).toBe('BRL');
    expect(corridor?.countryCode).toBe('BR');
  });

  it('ntokens home domain is registered in ANCHOR_HOME_DOMAINS', () => {
    expect(ANCHOR_HOME_DOMAINS['ntokens']).toBe('ntokens.com');
  });
});
