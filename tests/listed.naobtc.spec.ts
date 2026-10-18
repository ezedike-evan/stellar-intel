import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ANCHORS } from '@/constants/anchors';
import { fixtureMismatches, getListedAnchorByDomain } from '@/lib/stellar/listed-anchors';

describe('listed operator: NaoBTC', () => {
  const entry = getListedAnchorByDomain('naobtc.com');

  it('is a crypto-rails entry, found by every domain', () => {
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('naobtc');
    expect(entry?.kind).toBe('crypto-rails');
    for (const domain of entry?.domains ?? []) {
      expect(getListedAnchorByDomain(domain)).toBe(entry);
    }
  });

  it('lists exactly the BTC asset', () => {
    expect(entry?.assets).toHaveLength(1);
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'BTC',
        issuer: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ65JJLDHKHRUZI3EUEKMTCH',
      })
    );
  });

  it('matches its stellar.toml fixture', () => {
    const toml = readFileSync('tests/fixtures/listed/naobtc.toml', 'utf8');
    expect(entry && fixtureMismatches(entry, toml)).toEqual([]);
  });

  it('is not a routable anchor', () => {
    const domains = entry?.domains ?? [];
    for (const a of ANCHORS) {
      expect(domains).not.toContain(a.homeDomain);
      if (a.serviceDomain) expect(domains).not.toContain(a.serviceDomain);
    }
  });

  it('has rails matching its SEP-6 /info fixture', () => {
    expect(entry?.cryptoRails).toBeDefined();
    expect(entry?.cryptoRails?.length).toBeGreaterThan(0);

    for (const rail of entry?.cryptoRails ?? []) {
      const raw = readFileSync(`tests/fixtures/listed/naobtc.${rail.sep}-info.json`, 'utf8');
      const info = JSON.parse(raw);

      const depositCodes = Object.entries(info.deposit ?? {})
        .filter(([, v]) => (v as { enabled?: boolean }).enabled === true)
        .map(([k]) => k);
      const withdrawCodes = Object.entries(info.withdraw ?? {})
        .filter(([, v]) => (v as { enabled?: boolean }).enabled === true)
        .map(([k]) => k);

      expect(rail.depositAssets).toEqual(depositCodes);
      expect(rail.withdrawAssets).toEqual(withdrawCodes);
    }
  });
});
