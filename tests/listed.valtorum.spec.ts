import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ANCHORS } from '@/constants/anchors';
import { LISTED_ANCHORS } from '@/constants/listed-anchors';
import { fixtureMismatches, getListedAnchorByDomain } from '@/lib/stellar/listed-anchors';

const FIXTURE_PATH = join(__dirname, 'fixtures', 'listed', 'valtorum.toml');

describe('listed anchor: valtorum', () => {
  const entry = getListedAnchorByDomain('valtorum.com');

  it('returns the entry for every domain', () => {
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('valtorum');
    expect(entry!.kind).toBe('issuer');

    for (const domain of entry!.domains) {
      expect(getListedAnchorByDomain(domain)).toBe(entry);
    }
  });

  it('lists the USDV asset', () => {
    expect(entry).toBeDefined();
    expect(entry!.assets).toHaveLength(1);
    expect(entry!.assets).toContainEqual(
      expect.objectContaining({
        code: 'USDV',
        issuer: 'GBLAJOKBIIT7P32BJQFCSRJVOE2SXHI4D5ZGLFJ4DLMFJXI2NN6R37G5',
      })
    );
  });

  it('matches the live toml fixture', () => {
    expect(entry).toBeDefined();
    const toml = readFileSync(FIXTURE_PATH, 'utf8');
    expect(fixtureMismatches(entry!, toml)).toEqual([]);
  });

  it('is not a routable ANCHORS entry', () => {
    expect(entry).toBeDefined();
    const domains = new Set<string | undefined>(entry!.domains);
    for (const anchor of ANCHORS) {
      expect(domains.has(anchor.homeDomain)).toBe(false);
      expect(domains.has(anchor.serviceDomain)).toBe(false);
    }
  });

  it('is registered in LISTED_ANCHORS', () => {
    expect(LISTED_ANCHORS.some((a) => a.id === 'valtorum')).toBe(true);
  });
});
