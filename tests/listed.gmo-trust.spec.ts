import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ANCHORS } from '@/constants/anchors';
import { fixtureMismatches, getListedAnchorByDomain } from '@/lib/stellar/listed-anchors';

describe('listed operator: GMO-Z.com Trust Company', () => {
  const entry = getListedAnchorByDomain('stablecoin.z.com');

  it('is an issuer-only entry, found by every domain', () => {
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('gmo-trust');
    expect(entry?.kind).toBe('issuer');
    for (const domain of entry?.domains ?? []) {
      expect(getListedAnchorByDomain(domain)).toBe(entry);
    }
  });

  it('lists exactly the GYEN and ZUSD assets', () => {
    expect(entry?.assets).toHaveLength(2);
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'GYEN',
        issuer: 'GDF6VOEGRWLOZ64PQQGKD2IYWA22RLT37GJKS2EJXZHT2VLAGWLC5TOB',
      })
    );
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'ZUSD',
        issuer: 'GDF6VOEGRWLOZ64PQQGKD2IYWA22RLT37GJKS2EJXZHT2VLAGWLC5TOB',
      })
    );
  });

  it('matches its stellar.toml fixture', () => {
    const toml = readFileSync('tests/fixtures/listed/gmo-trust.toml', 'utf8');
    expect(entry && fixtureMismatches(entry, toml)).toEqual([]);
  });

  it('is not a routable anchor', () => {
    const domains = entry?.domains ?? [];
    for (const a of ANCHORS) {
      expect(domains).not.toContain(a.homeDomain);
      if (a.serviceDomain) expect(domains).not.toContain(a.serviceDomain);
    }
  });
});
