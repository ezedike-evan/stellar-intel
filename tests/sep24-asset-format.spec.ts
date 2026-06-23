import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveAssetParams,
  getSep24Fee,
  fetchAnchorFee,
  initiateWithdraw,
  _clearInfoCache,
  type Sep24InfoResponse,
} from '@/lib/stellar/sep24';
import * as sep1 from '@/lib/stellar/sep1';

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24';

function buildMockInfo(isSep38Format: boolean): Sep24InfoResponse {
  if (isSep38Format) {
    return {
      deposit: { 'stellar:USDC:GA5Z...': { enabled: true } },
      withdraw: { 'stellar:USDC:GA5Z...': { enabled: true } },
      fee: { enabled: true },
      transaction: { enabled: true },
      transactions: { enabled: true },
    };
  }

  return {
    deposit: { USDC: { enabled: true } },
    withdraw: { USDC: { enabled: true } },
    fee: { enabled: true },
    transaction: { enabled: true },
    transactions: { enabled: true },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  _clearInfoCache();
  process.env.TEST_SEP24_INFO = '1';
});

describe('resolveAssetParams', () => {
  it('returns old style params if info uses old format', () => {
    const info = buildMockInfo(false);
    const params = resolveAssetParams(info, 'withdraw', 'USDC', 'GA5Z...');
    expect(params.asset_code).toBe('USDC');
    expect(params.asset_issuer).toBe('GA5Z...');
    expect(params.asset).toBeUndefined();
  });

  it('returns new style params if info uses SEP-38 format', () => {
    const info = buildMockInfo(true);
    const params = resolveAssetParams(info, 'withdraw', 'USDC', 'GA5Z...');
    expect(params.asset).toBe('stellar:USDC:GA5Z...');
    expect(params.asset_code).toBeUndefined();
  });

  it('returns new style params for native XLM if info uses SEP-38 format', () => {
    const info: Sep24InfoResponse = {
      deposit: { 'stellar:native': { enabled: true } },
      withdraw: { 'stellar:native': { enabled: true } },
      fee: { enabled: true },
      transaction: { enabled: true },
      transactions: { enabled: true },
    };
    const params = resolveAssetParams(info, 'withdraw', 'XLM', undefined);
    expect(params.asset).toBe('stellar:native');
  });

  describe('resolveAssetParams fallback', () => {
    it('returns old format with issuer if info missing', () => {
      const result = resolveAssetParams(null as any, 'withdraw', 'USDC', 'ISSUER_A');
      expect(result).toEqual({ asset_code: 'USDC', asset_issuer: 'ISSUER_A' });
    });

    it('returns old format without issuer if info missing and no issuer passed', () => {
      const result = resolveAssetParams(null as any, 'withdraw', 'USDC', undefined);
      expect(result).toEqual({ asset_code: 'USDC' });
    });
  });
});

describe('getSep24Fee asset formats', () => {
  it('encodes correctly for old style anchor', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/info')) return { ok: true, json: async () => buildMockInfo(false) };
        capturedUrl = url;
        return { ok: true, json: async () => ({ fee: 5 }) };
      })
    );

    await getSep24Fee({
      transferServer: TRANSFER_SERVER,
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      amount: '100',
      type: 'bank_account',
    } as any);

    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.searchParams.get('asset_code')).toBe('USDC');
    expect(parsedUrl.searchParams.get('asset_issuer')).toBe('GA5Z...');
    expect(parsedUrl.searchParams.has('asset')).toBe(false);
  });

  it('encodes correctly for new style anchor', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/info')) return { ok: true, json: async () => buildMockInfo(true) };
        capturedUrl = url;
        return { ok: true, json: async () => ({ fee: 5 }) };
      })
    );

    await getSep24Fee({
      transferServer: TRANSFER_SERVER,
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      amount: '100',
      type: 'bank_account',
    } as any);

    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.searchParams.get('asset')).toBe('stellar:USDC:GA5Z...');
    expect(parsedUrl.searchParams.has('asset_code')).toBe(false);
  });
});

describe('initiateWithdraw asset formats', () => {
  it('sends correct body for old style anchor', async () => {
    let capturedBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: any) => {
        if (url.endsWith('/info')) return { ok: true, json: async () => buildMockInfo(false) };
        capturedBody = init?.body;
        return {
          ok: true,
          json: async () => ({ type: 'interactive_customer_info_needed', url: 'test', id: '123' }),
        };
      })
    );

    await initiateWithdraw(
      {
        domain: 'cowrie.exchange',
        homeDomain: 'cowrie.exchange',
        TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
        capabilities: { sep24: true },
      } as any,
      {
        jwt: 'abc',
        assetCode: 'USDC',
        assetIssuer: 'GA5Z...',
        amount: '100',
        account: 'GABC',
        type: 'bank_account',
      } as any
    );

    const body = JSON.parse(capturedBody);
    expect(body.asset_code).toBe('USDC');
    expect(body.asset_issuer).toBe('GA5Z...');
    expect(body.asset).toBeUndefined();
  });

  it('sends correct body for new style anchor', async () => {
    let capturedBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: any) => {
        if (url.endsWith('/info')) return { ok: true, json: async () => buildMockInfo(true) };
        capturedBody = init?.body;
        return {
          ok: true,
          json: async () => ({ type: 'interactive_customer_info_needed', url: 'test', id: '123' }),
        };
      })
    );

    await initiateWithdraw(
      {
        domain: 'cowrie.exchange',
        homeDomain: 'cowrie.exchange',
        TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
        capabilities: { sep24: true },
      } as any,
      {
        jwt: 'abc',
        assetCode: 'USDC',
        assetIssuer: 'GA5Z...',
        amount: '100',
        account: 'GABC',
        type: 'bank_account',
      } as any
    );

    const body = JSON.parse(capturedBody);
    expect(body.asset).toBe('stellar:USDC:GA5Z...');
    expect(body.asset_code).toBeUndefined();
  });
});
