import { describe, expect, it } from 'vitest';
import { validateAnchorAssetIssuer, validateCorridorAssetIssuers } from '@/lib/stellar/anchors';
import type { Corridor } from '@/types';

// Asset-issuer validation (#489): an anchor must settle the canonical issuer for
// its registered asset, not a look-alike reusing a trusted code like "USDC".

const CANONICAL = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const LOOKALIKE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const anchor = { id: 'cowrie', assetCode: 'USDC', assetIssuer: CANONICAL };

describe('validateAnchorAssetIssuer', () => {
  it('matches when the toml advertises the canonical issuer', () => {
    expect(validateAnchorAssetIssuer(anchor, [{ code: 'USDC', issuer: CANONICAL }])).toEqual({
      anchorId: 'cowrie',
      assetCode: 'USDC',
      expectedIssuer: CANONICAL,
      advertisedIssuer: CANONICAL,
      status: 'match',
    });
  });

  it('flags a look-alike issuer as a mismatch', () => {
    const result = validateAnchorAssetIssuer(anchor, [{ code: 'USDC', issuer: LOOKALIKE }]);
    expect(result.status).toBe('mismatch');
    expect(result.advertisedIssuer).toBe(LOOKALIKE);
    expect(result.expectedIssuer).toBe(CANONICAL);
  });

  it('reports missing when the toml advertises no issuer for the asset code', () => {
    expect(validateAnchorAssetIssuer(anchor, [{ code: 'USDC' }]).status).toBe('missing');
    expect(validateAnchorAssetIssuer(anchor, []).status).toBe('missing');
  });

  it('ignores currencies for other asset codes', () => {
    const result = validateAnchorAssetIssuer(anchor, [
      { code: 'EURC', issuer: CANONICAL },
      { code: 'USDC', issuer: LOOKALIKE },
    ]);
    expect(result.status).toBe('mismatch');
    expect(result.advertisedIssuer).toBe(LOOKALIKE);
  });
});

// Multi-asset anchors (ANC027): every distinct corridor asset is checked, not just
// the anchor's primary assetCode/assetIssuer.

const ARS_ISSUER = 'GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS';
const PEN_ISSUER = 'GA4TDPNUCZPTOHB3TKUYMDCRVATXKEADH7ZEYEBWJKQKE2UBFCYNBPEN';

const corridor = (id: string, from: string, fromIssuer: string | null): Corridor => ({
  id,
  from,
  fromIssuer,
  fromPeg: 'USD',
  to: 'XXX',
  countryCode: 'XX',
  countryName: 'Testland',
});

const fakeCorridors: Corridor[] = [
  corridor('ars-xxx', 'ARS', ARS_ISSUER),
  corridor('pen-xxx', 'PEN', PEN_ISSUER),
  corridor('pen-yyy', 'PEN', PEN_ISSUER),
  corridor('xlm-xxx', 'XLM', null),
];

describe('validateCorridorAssetIssuers', () => {
  it('returns match then mismatch for a two-corridor anchor with one impostor issuer', () => {
    const multi = { id: 'multi', corridors: ['ars-xxx', 'pen-xxx'] };
    const results = validateCorridorAssetIssuers(
      multi,
      [
        { code: 'ARS', issuer: ARS_ISSUER },
        { code: 'PEN', issuer: LOOKALIKE },
      ],
      fakeCorridors
    );
    expect(results.map((r) => r.status)).toEqual(['match', 'mismatch']);
    expect(results[1]).toEqual({
      anchorId: 'multi',
      assetCode: 'PEN',
      expectedIssuer: PEN_ISSUER,
      advertisedIssuer: LOOKALIKE,
      status: 'mismatch',
    });
  });

  it('skips native corridors and unknown corridor ids', () => {
    const results = validateCorridorAssetIssuers(
      { id: 'multi', corridors: ['xlm-xxx', 'nope', 'ars-xxx'] },
      [{ code: 'ARS', issuer: ARS_ISSUER }],
      fakeCorridors
    );
    expect(results.map((r) => r.assetCode)).toEqual(['ARS']);
  });

  it('validates each distinct (code, issuer) once', () => {
    const results = validateCorridorAssetIssuers(
      { id: 'multi', corridors: ['pen-xxx', 'pen-yyy'] },
      [{ code: 'PEN', issuer: PEN_ISSUER }],
      fakeCorridors
    );
    expect(results).toHaveLength(1);
  });

  it('uses the corridor registry by default (anclap serves ARS and PEN)', () => {
    const results = validateCorridorAssetIssuers(
      { id: 'anclap', corridors: ['ars-ars', 'pen-pen'] },
      [
        { code: 'ARS', issuer: ARS_ISSUER },
        { code: 'PEN', issuer: LOOKALIKE },
      ]
    );
    expect(results.map((r) => [r.assetCode, r.status])).toEqual([
      ['ARS', 'match'],
      ['PEN', 'mismatch'],
    ]);
  });
});
