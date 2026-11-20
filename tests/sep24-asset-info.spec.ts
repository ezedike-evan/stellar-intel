import { describe, it, expect } from 'vitest';

import { findSep24AssetInfo, listEnabledAssets, type Sep24InfoResponse } from '@/lib/stellar/sep24';

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function infoWith(deposit: Sep24InfoResponse['deposit']): Sep24InfoResponse {
  return {
    deposit,
    withdraw: {},
    fee: { enabled: true },
    transaction: { enabled: true },
    transactions: { enabled: true },
  };
}

describe('findSep24AssetInfo', () => {
  it('finds a code-keyed asset', () => {
    const info = infoWith({ USDC: { enabled: true, fee_fixed: 0.5 } });
    expect(findSep24AssetInfo(info, 'deposit', 'USDC', USDC_ISSUER)).toEqual({
      enabled: true,
      fee_fixed: 0.5,
    });
  });

  it('prefers the SEP-38 identifier key over the bare code', () => {
    const info = infoWith({
      [`stellar:USDC:${USDC_ISSUER}`]: { enabled: true, fee_percent: 1 },
      USDC: { enabled: false },
    });
    expect(findSep24AssetInfo(info, 'deposit', 'USDC', USDC_ISSUER)).toEqual({
      enabled: true,
      fee_percent: 1,
    });
  });

  it('resolves native XLM through stellar:native and native keys', () => {
    expect(
      findSep24AssetInfo(infoWith({ 'stellar:native': { enabled: true } }), 'deposit', 'XLM')
    ).toEqual({ enabled: true });
    expect(
      findSep24AssetInfo(infoWith({ native: { enabled: true, min_amount: 5 } }), 'deposit', 'XLM')
    ).toEqual({ enabled: true, min_amount: 5 });
  });

  it('returns null for a missing asset or operation map', () => {
    expect(findSep24AssetInfo(infoWith({}), 'deposit', 'USDC', USDC_ISSUER)).toBeNull();
    expect(findSep24AssetInfo(null, 'deposit', 'USDC', USDC_ISSUER)).toBeNull();
    const noWithdraw = { deposit: { USDC: { enabled: true } } } as unknown as Sep24InfoResponse;
    expect(findSep24AssetInfo(noWithdraw, 'withdraw', 'USDC', USDC_ISSUER)).toBeNull();
  });
});

describe('listEnabledAssets', () => {
  it('lists enabled assets, parsing identifier-style keys', () => {
    const info = infoWith({
      [`stellar:USDC:${USDC_ISSUER}`]: { enabled: true, fee_fixed: 0.5 },
      native: { enabled: true },
      NGNT: { enabled: true },
    });
    const assets = listEnabledAssets(info, 'deposit');
    expect(assets).toHaveLength(3);
    expect(assets).toContainEqual({
      key: `stellar:USDC:${USDC_ISSUER}`,
      code: 'USDC',
      issuer: USDC_ISSUER,
      info: { enabled: true, fee_fixed: 0.5 },
    });
    expect(assets).toContainEqual({
      key: 'native',
      code: 'XLM',
      issuer: null,
      info: { enabled: true },
    });
    expect(assets).toContainEqual({
      key: 'NGNT',
      code: 'NGNT',
      issuer: null,
      info: { enabled: true },
    });
  });

  it('excludes disabled assets', () => {
    const info = infoWith({
      USDC: { enabled: true },
      SRT: { enabled: false },
    });
    const assets = listEnabledAssets(info, 'deposit');
    expect(assets.map((a) => a.code)).toEqual(['USDC']);
  });

  it('returns an empty list for a missing operation map', () => {
    expect(listEnabledAssets(null, 'deposit')).toEqual([]);
    const noDeposit = { withdraw: { USDC: { enabled: true } } } as unknown as Sep24InfoResponse;
    expect(listEnabledAssets(noDeposit, 'deposit')).toEqual([]);
  });
});
