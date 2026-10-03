import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ANCHORS } from '@/constants/anchors';
import { fixtureMismatches, getListedAnchorByDomain } from '@/lib/stellar/listed-anchors';

describe('listed operator: Nafuloo', () => {
  const entry = getListedAnchorByDomain('nafuloo.com');

  it('is an issuer-only entry, found by every domain', () => {
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('nafuloo');
    expect(entry?.kind).toBe('issuer');
    for (const domain of entry?.domains ?? []) {
      expect(getListedAnchorByDomain(domain)).toBe(entry);
    }
  });

  it('lists exactly the NAFU and NFIUM assets', () => {
    expect(entry?.assets).toHaveLength(2);
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'NAFU',
        issuer: 'GBHA4FGPHX7KURMP7CZU7SQ2UOAGTAQ22SCHPK5P5XCQHZXCSVXQJFYB',
      })
    );
  });

  it('also lists NFIUM', () => {
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'NFIUM',
        issuer: 'GD76B36XOOH432PICDIVEOD4RU7TEFJ5DZVA2C5MW5LKTSCARK45V3DB',
      })
    );
  });

  it('matches its stellar.toml fixture', () => {
    const toml = readFileSync('tests/fixtures/listed/nafuloo.toml', 'utf8');
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
