import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ANCHORS } from '@/constants/anchors';
import { fixtureMismatches, getListedAnchorByDomain } from '@/lib/stellar/listed-anchors';

type InfoBody = Record<
  'deposit' | 'withdraw',
  Record<string, { enabled?: boolean; types?: Record<string, unknown> }>
>;

/** Asset codes a SEP-6/SEP-24 `/info` body marks `enabled: true`, sorted. */
function enabledCodes(info: InfoBody, side: 'deposit' | 'withdraw'): string[] {
  return Object.entries(info[side] ?? {})
    .filter(([, asset]) => asset.enabled === true)
    .map(([code]) => code)
    .sort();
}

/** Withdraw `types` offered by the enabled withdraw assets, sorted and de-duplicated. */
function withdrawTypes(info: InfoBody): string[] {
  const types = new Set<string>();
  for (const asset of Object.values(info.withdraw ?? {})) {
    if (asset.enabled === true) for (const t of Object.keys(asset.types ?? {})) types.add(t);
  }
  return [...types].sort();
}

describe('listed operator: Ultra Capital', () => {
  const entry = getListedAnchorByDomain('ultracapital.xyz');

  it('is a crypto-rails entry, found by every domain', () => {
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('ultra-capital');
    expect(entry?.kind).toBe('crypto-rails');
    expect(entry?.domains).toContain('ultrastellar.com');
    for (const domain of entry?.domains ?? []) {
      expect(getListedAnchorByDomain(domain)).toBe(entry);
    }
  });

  it('lists exactly the six crypto assets', () => {
    expect(entry?.assets).toHaveLength(6);
    expect(entry?.assets).toContainEqual(
      expect.objectContaining({
        code: 'yUSDC',
        issuer: 'GDGTVWSM4MGS4T7Z6W4RPWOCHE2I6RDFCIFZGS3DOA63LWQTRNZNTTFF',
      })
    );
  });

  it('matches its stellar.toml fixture', () => {
    const toml = readFileSync('tests/fixtures/listed/ultra-capital.toml', 'utf8');
    expect(entry && fixtureMismatches(entry, toml)).toEqual([]);
  });

  it('is not a routable anchor', () => {
    const domains = entry?.domains ?? [];
    for (const a of ANCHORS) {
      expect(domains).not.toContain(a.homeDomain);
      if (a.serviceDomain) expect(domains).not.toContain(a.serviceDomain);
    }
  });

  it('records each rail as its /info fixture enables it', () => {
    const rails = entry?.cryptoRails ?? [];
    expect(rails.map((r) => r.sep).sort()).toEqual(['sep24', 'sep6']);
    for (const rail of rails) {
      const info = JSON.parse(
        readFileSync(`tests/fixtures/listed/ultra-capital.${rail.sep}-info.json`, 'utf8')
      ) as InfoBody;
      expect([...rail.depositAssets].sort(), `${rail.sep} deposit`).toEqual(
        enabledCodes(info, 'deposit')
      );
      expect([...rail.withdrawAssets].sort(), `${rail.sep} withdraw`).toEqual(
        enabledCodes(info, 'withdraw')
      );
      expect([...rail.withdrawTypes].sort(), `${rail.sep} withdraw types`).toEqual(
        withdrawTypes(info)
      );
    }
  });

  it('lists every rail asset code among its own assets', () => {
    const codes = new Set(entry?.assets.map((a) => a.code));
    for (const rail of entry?.cryptoRails ?? []) {
      for (const code of [...rail.depositAssets, ...rail.withdrawAssets]) {
        expect(codes.has(code), `${rail.sep} ${code}`).toBe(true);
      }
    }
  });
});
