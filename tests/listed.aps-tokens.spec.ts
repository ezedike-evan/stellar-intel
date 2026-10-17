import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ANCHORS } from '@/constants/anchors';
import { fixtureMismatches, getListedAnchorByDomain } from '@/lib/stellar/listed-anchors';

describe('listed operator: APS (Advanced Payment Solutions)', () => {
  const entry = getListedAnchorByDomain('aps.money');

  it('is an issuer-only entry, found by every domain', () => {
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('aps-tokens');
    expect(entry?.kind).toBe('issuer');
    for (const domain of entry?.domains ?? []) {
      expect(getListedAnchorByDomain(domain)).toBe(entry);
    }
  });

  it('lists exactly the 13 APS fiat stablecoins including APSBRLM', () => {
    expect(entry?.assets).toHaveLength(13);
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'APSBRLM',
        issuer: 'GB7OUO5NY5WQKXJJ7PFFZEJOKN4BA7IOEN3Z6SWAY26LGTREJJYZH2ZT',
      })
    );
  });

  it('matches its stellar.toml fixture', () => {
    const toml = readFileSync('tests/fixtures/listed/aps-tokens.toml', 'utf8');
    expect(entry && fixtureMismatches(entry, toml)).toEqual([]);
  });

  it('is not a routable anchor', () => {
    const domains = entry?.domains ?? [];
    for (const a of ANCHORS) {
      expect(domains).not.toContain(a.homeDomain);
      if (a.serviceDomain) expect(domains).not.toContain(a.serviceDomain);
    }
  });

  it('points at the registered aps anchor', () => {
    expect(entry?.registeredAnchorId).toBe('aps');
    expect(ANCHORS.some((a) => a.id === 'aps')).toBe(true);
  });
});
