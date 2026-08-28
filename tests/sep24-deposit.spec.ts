import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initiateDeposit, Sep24DepositError } from '@/lib/stellar/sep24';

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24';

const RESOLVED_ANCHOR = {
  id: 'cowrie',
  name: 'Cowrie',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
  WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
  SIGNING_KEY: 'G...',
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
  domain: 'anchor.domain',
  ANCHOR_QUOTE_SERVER: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
};

const PARAMS = {
  jwt: 'test-jwt',
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  amount: '100',
  account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('initiateDeposit — POST /transactions/deposit/interactive', () => {
  it('returns typed { id, url, type } on a valid anchor response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          type: 'interactive_customer_info_needed',
          url: 'https://anchor.io/kyc/session-abc',
          id: 'txn-xyz',
        }),
      }))
    );

    const result = await initiateDeposit(RESOLVED_ANCHOR, PARAMS);
    expect(result.id).toBe('txn-xyz');
    expect(result.url).toBe('https://anchor.io/kyc/session-abc');
    expect(result.type).toBe('interactive_customer_info_needed');
  });

  it('sends correct POST body: asset_code, asset_issuer, amount, account', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: RequestInit) => {
        body = JSON.parse(opts.body as string) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({
            type: 'interactive_customer_info_needed',
            url: 'https://u',
            id: 'id1',
          }),
        };
      })
    );

    await initiateDeposit(RESOLVED_ANCHOR, PARAMS);
    expect(body['asset_code']).toBe('USDC');
    expect(body['asset_issuer']).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    expect(body['amount']).toBe('100');
    expect(body['account']).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });

  it('sends Authorization: Bearer <jwt> header', async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: RequestInit) => {
        headers = opts.headers as Record<string, string>;
        return {
          ok: true,
          json: async () => ({
            type: 'interactive_customer_info_needed',
            url: 'https://u',
            id: 'id1',
          }),
        };
      })
    );

    await initiateDeposit(RESOLVED_ANCHOR, PARAMS);
    expect(headers['Authorization']).toBe('Bearer test-jwt');
  });

  it('throws Sep24DepositError on a non-ok HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'bad request' }),
      }))
    );

    await expect(initiateDeposit(RESOLVED_ANCHOR, PARAMS)).rejects.toThrow(Sep24DepositError);
  });

  it('throws when the anchor does not support SEP-24', async () => {
    const noSep24Anchor = {
      ...RESOLVED_ANCHOR,
      TRANSFER_SERVER_SEP0024: null,
      capabilities: { ...RESOLVED_ANCHOR.capabilities, sep24: false },
    };

    await expect(initiateDeposit(noSep24Anchor, PARAMS)).rejects.toThrow(
      /does not support SEP-24 deposits/
    );
  });

  it('throws when the anchor response type is not interactive_customer_info_needed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ type: 'non_interactive_customer_info_needed' }),
      }))
    );

    await expect(initiateDeposit(RESOLVED_ANCHOR, PARAMS)).rejects.toThrow(
      /Unexpected response type/
    );
  });
});
