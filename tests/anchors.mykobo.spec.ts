import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

describe('mykobo.co triage (B028)', () => {
  const mykobo = ANCHORS.find((a) => a.id === 'mykobo');

  it('is included in ANCHORS — has EUR off-ramp capability', () => {
    expect(mykobo).toBeDefined();
  });

  it('has correct home domain', () => {
    expect(mykobo?.homeDomain).toBe('mykobo.co');
  });

  it('has correct service domain for SEP endpoints', () => {
    expect(mykobo?.serviceDomain).toBe('stellar.mykobo.co');
  });

  it('anchors EURC with the correct issuer', () => {
    expect(mykobo?.assetCode).toBe('EURC');
    expect(mykobo?.assetIssuer).toBe('GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM');
  });

  it('serves the usdc-eur corridor', () => {
    expect(mykobo?.corridors).toContain('usdc-eur');
  });

  it('declares sep6 capability', () => {
    expect(mykobo?.seps).toContain('sep6');
  });

  it('declares sep24 capability', () => {
    expect(mykobo?.seps).toContain('sep24');
  });

  it('declares sep31 capability', () => {
    expect(mykobo?.seps).toContain('sep31');
  });

  it('usdc-eur corridor is defined in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-eur');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.to).toBe('EUR');
  });

  it('mykobo home domain is registered in ANCHOR_HOME_DOMAINS', () => {
    expect(ANCHOR_HOME_DOMAINS['mykobo']).toBe('mykobo.co');
  });
});
