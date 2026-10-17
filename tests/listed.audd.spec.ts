import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ANCHORS } from '@/constants/anchors';
import { fixtureMismatches, getListedAnchorByDomain } from '@/lib/stellar/listed-anchors';

describe('listed operator: AUDD', () => {
  const entry = getListedAnchorByDomain('audd.digital');

  it('is an issuer-only entry, found by every domain', () => {
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('audd');
    expect(entry?.kind).toBe('issuer');
    for (const domain of entry?.domains ?? []) {
      expect(getListedAnchorByDomain(domain)).toBe(entry);
    }
  });

  it('lists exactly the AUDD and NZDSC assets', () => {
    expect(entry?.assets).toHaveLength(2);
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'AUDD',
        issuer: 'GDC7X2MXTYSAKUUGAIQ7J7RPEIM7GXSAIWFYWWH4GLNFECQVJJLB2EEU',
      })
    );
  });

  it('matches its stellar.toml fixture', () => {
    const toml = readFileSync('tests/fixtures/listed/audd.toml', 'utf8');
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
