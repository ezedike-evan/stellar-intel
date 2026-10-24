import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StellarToml } from '@stellar/stellar-sdk';
import { resolveToml, _clearTomlCache } from '@/lib/stellar/sep1';

describe('SEP-1 Resolver Fixtures', () => {
  beforeEach(() => {
    _clearTomlCache();
    vi.restoreAllMocks();
  });

  // Server URLs are only kept when they sit on a registered anchor host (see
  // safeServerUrl in lib/stellar/sep1.ts), so every fixture uses a registered
  // domain. The old bitso, flutterwave, tempo and mychoice fixtures used hosts
  // that are not in the registry, and would now be dropped by design.
  const fixtures = [
    {
      name: 'cowrie',
      domain: 'cowrie.exchange',
      toml: {
        TRANSFER_SERVER_SEP0024: 'https://api.cowrie.exchange/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.cowrie.exchange/auth',
        SIGNING_KEY: 'GAYOLLLUIZNCXT667S6H6XGIZ664S2I2OTXF2SNC6W56F35J5XNQUU7B',
      },
      expected: {
        TRANSFER_SERVER_SEP0024: 'https://api.cowrie.exchange/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.cowrie.exchange/auth',
        SIGNING_KEY: 'GAYOLLLUIZNCXT667S6H6XGIZ664S2I2OTXF2SNC6W56F35J5XNQUU7B',
        capabilities: {
          sep10: true,
          sep24: true,
          sep38: false,
          sep12: true,
        },
      },
    },
    {
      name: 'anclap',
      domain: 'anclap.com',
      toml: {
        TRANSFER_SERVER_SEP0024: 'https://api.anclap.com/stellar/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.anclap.com/stellar/auth',
        SIGNING_KEY: 'GABXNVRVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNV',
      },
      expected: {
        TRANSFER_SERVER_SEP0024: 'https://api.anclap.com/stellar/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.anclap.com/stellar/auth',
        SIGNING_KEY: 'GABXNVRVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNVNV',
        capabilities: {
          sep10: true,
          sep24: true,
          sep38: false,
          sep12: true,
        },
      },
    },
    {
      name: 'zeam',
      domain: 'zeam.money',
      toml: {
        TRANSFER_SERVER_SEP0024: 'https://api.zeam.money/v3/stellar/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.zeam.money/v3/stellar/auth',
        SIGNING_KEY: 'GBFLUTTERWAVE',
      },
      expected: {
        TRANSFER_SERVER_SEP0024: 'https://api.zeam.money/v3/stellar/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.zeam.money/v3/stellar/auth',
        SIGNING_KEY: 'GBFLUTTERWAVE',
        capabilities: {
          sep10: true,
          sep24: true,
          sep38: false,
          sep12: true,
        },
      },
    },
    {
      name: 'ntokens',
      domain: 'ntokens.com',
      toml: {
        TRANSFER_SERVER_SEP0024: 'https://ntokens.com/api/sep24',
        WEB_AUTH_ENDPOINT: 'https://ntokens.com/api/auth',
        SIGNING_KEY: 'GATEMPO',
        ANCHOR_QUOTE_SERVER: 'https://ntokens.com/api/sep38',
      },
      expected: {
        TRANSFER_SERVER_SEP0024: 'https://ntokens.com/api/sep24',
        WEB_AUTH_ENDPOINT: 'https://ntokens.com/api/auth',
        SIGNING_KEY: 'GATEMPO',
        capabilities: {
          sep10: true,
          sep24: true,
          sep38: true,
          sep12: true,
        },
      },
    },
    {
      name: 'sofizpay',
      domain: 'sofizpay.com',
      toml: {
        TRANSFER_SERVER_SEP0024: 'https://api.sofizpay.com/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.sofizpay.com/auth',
        SIGNING_KEY: 'GAMYCHOICE',
      },
      expected: {
        TRANSFER_SERVER_SEP0024: 'https://api.sofizpay.com/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.sofizpay.com/auth',
        SIGNING_KEY: 'GAMYCHOICE',
        capabilities: {
          sep10: true,
          sep24: true,
          sep38: false,
          sep12: true,
        },
      },
    },
    {
      name: 'moneygram',
      domain: 'stellar.moneygram.com',
      toml: {
        TRANSFER_SERVER_SEP0024: 'https://api.stellar.moneygram.com/auth/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.stellar.moneygram.com/auth/openid',
        SIGNING_KEY: 'GAMONEYGRAM',
      },
      expected: {
        TRANSFER_SERVER_SEP0024: 'https://api.stellar.moneygram.com/auth/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.stellar.moneygram.com/auth/openid',
        SIGNING_KEY: 'GAMONEYGRAM',
        capabilities: {
          sep10: true,
          sep24: true,
          sep38: false,
          sep12: true,
        },
      },
    },
  ];

  fixtures.forEach(({ name, domain, toml, expected }) => {
    it(`correctly resolves capabilities and endpoints for ${name}`, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(toml as any);

      const result = await resolveToml(domain);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.TRANSFER_SERVER_SEP0024).toBe(expected.TRANSFER_SERVER_SEP0024);
        expect(result.data.WEB_AUTH_ENDPOINT).toBe(expected.WEB_AUTH_ENDPOINT);
        expect(result.data.SIGNING_KEY).toBe(expected.SIGNING_KEY);
        expect(result.data.capabilities).toEqual(expect.objectContaining(expected.capabilities));
      }
    });
  });
});
