import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

const ARST_ISSUER = 'GCSAZVWXZKWS4XS223M5F54H2B6XPIIXZZGP7KEAIU6YSL5HDRGCI3DG';
const BRLT_ISSUER = 'GCHQ3F2BF5P74DMDNOOGHT5DUCKC773AW5DTOFINC26W4KGYFPYDPRSO';

describe('Latamex (Settle Network) onboarding', () => {
  const latamex = ANCHORS.find((a) => a.id === 'latamex');

  it('is registered', () => {
    expect(latamex).toBeDefined();
    expect(latamex?.name).toBe('Latamex');
  });

  it('has the home domain from its stellar.toml', () => {
    expect(latamex?.homeDomain).toBe('pubnet-sep.latamex.com');
    expect(ANCHOR_HOME_DOMAINS['latamex']).toBe('pubnet-sep.latamex.com');
  });

  it('anchors ARST with the correct issuer', () => {
    expect(latamex?.assetCode).toBe('ARST');
    expect(latamex?.assetIssuer).toBe(ARST_ISSUER);
  });

  it('serves the arst-ars and brlt-brl corridors', () => {
    expect(latamex?.corridors).toContain('arst-ars');
    expect(latamex?.corridors).toContain('brlt-brl');
  });

  it('declares SEP-6 and SEP-24 support', () => {
    expect(latamex?.seps).toContain('sep6');
    expect(latamex?.seps).toContain('sep24');
  });

  it('keeps the entry flat (no nested objects)', () => {
    for (const value of Object.values(latamex ?? {})) {
      if (value !== null && typeof value === 'object') {
        expect(Array.isArray(value)).toBe(true);
      }
    }
  });

  it('defines arst-ars in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'arst-ars');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('ARST');
    expect(corridor?.fromIssuer).toBe(ARST_ISSUER);
    expect(corridor?.fromPeg).toBe('ARS');
    expect(corridor?.to).toBe('ARS');
    expect(corridor?.countryCode).toBe('AR');
  });

  it('defines brlt-brl in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'brlt-brl');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('BRLT');
    expect(corridor?.fromIssuer).toBe(BRLT_ISSUER);
    expect(corridor?.fromPeg).toBe('BRL');
    expect(corridor?.to).toBe('BRL');
    expect(corridor?.countryCode).toBe('BR');
  });
});
