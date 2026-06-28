import { describe, expect, it } from 'vitest';
import { validateAnchorAssetIssuer } from '@/lib/stellar/anchors';

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
