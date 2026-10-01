import { describe, it, expect } from 'vitest';
import {
  ANCHORS,
  CORRIDORS,
  ANCHOR_HOME_DOMAINS,
  V11_CORRIDOR_IDS,
  VISIBLE_CORRIDORS,
} from '@/constants/anchors';

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

  it('serves the usdc-ars and usdc-brl corridors via SEP-6 withdraw-exchange', () => {
    expect(latamex?.corridors).toEqual(['arst-ars', 'brlt-brl', 'usdc-ars', 'usdc-brl']);
    expect(CORRIDORS.find((c) => c.id === 'usdc-ars')?.to).toBe('ARS');
    expect(CORRIDORS.find((c) => c.id === 'usdc-brl')?.to).toBe('BRL');
  });

  it('makes usdc-ars visible now that latamex serves it', () => {
    expect(V11_CORRIDOR_IDS.has('usdc-ars')).toBe(false);
    expect(VISIBLE_CORRIDORS.some((c) => c.id === 'usdc-ars')).toBe(true);
  });
});
