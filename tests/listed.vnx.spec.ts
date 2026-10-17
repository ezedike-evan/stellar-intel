import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ANCHORS } from '@/constants/anchors';
import { fixtureMismatches, getListedAnchorByDomain } from '@/lib/stellar/listed-anchors';

describe('listed operator: VNX', () => {
  const entry = getListedAnchorByDomain('vnx.io');

  it('is an issuer-only entry, found by every domain', () => {
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('vnx');
    expect(entry?.kind).toBe('issuer');
    for (const domain of entry?.domains ?? []) {
      expect(getListedAnchorByDomain(domain)).toBe(entry);
    }
  });

  it('lists exactly the VCHF asset', () => {
    expect(entry?.assets).toHaveLength(1);
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'VCHF',
        issuer: 'GDXLSLCOPPHTWOQXLLKSVN4VN3G67WD2ENU7UMVAROEYVJLSPSEWXIZN',
      })
    );
  });

  it('matches its stellar.toml fixture', () => {
    const toml = readFileSync('tests/fixtures/listed/vnx.toml', 'utf8');
    expect(entry && fixtureMismatches(entry, toml)).toEqual([]);
  });

  it('is not a routable anchor', () => {
    const domains = entry?.domains ?? [];
    for (const a of ANCHORS) {
      expect(domains).not.toContain(a.homeDomain);
      if (a.serviceDomain) expect(domains).not.toContain(a.serviceDomain);
    }
  });

  it('is not linked to a registered anchor', () => {
    expect(entry?.registeredAnchorId).toBeUndefined();
  });
});
