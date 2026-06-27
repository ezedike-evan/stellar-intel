import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StellarToml } from '@stellar/stellar-sdk';
import { resolveToml, isIssuerOnlyDomain, _clearTomlCache } from '@/lib/stellar/sep1';
import { getResolvedAnchorById } from '@/lib/stellar/anchors';

describe('SEP-1 Home-Domain vs Service-Domain Resolution', () => {
  beforeEach(() => {
    _clearTomlCache();
    vi.restoreAllMocks();
  });

  describe('isIssuerOnlyDomain', () => {
    it('returns true when serviceDomain differs from homeDomain', () => {
      const result = isIssuerOnlyDomain('mgusd.moneygram.com', 'stellar.moneygram.com');
      expect(result).toBe(true);
    });

    it('returns false when serviceDomain matches homeDomain', () => {
      const result = isIssuerOnlyDomain('stellar.moneygram.com', 'stellar.moneygram.com');
      expect(result).toBe(false);
    });

    it('returns false when serviceDomain is undefined', () => {
      const result = isIssuerOnlyDomain('mgusd.moneygram.com', undefined);
      expect(result).toBe(false);
    });

    it('returns false when serviceDomain is not provided', () => {
      const result = isIssuerOnlyDomain('mgusd.moneygram.com');
      expect(result).toBe(false);
    });
  });

  describe('Service domain resolution', () => {
    const moneygramHomeDomain = 'mgusd.moneygram.com';
    const moneygramServiceDomain = 'stellar.moneygram.com';

    const homeTomlResponse = {
      // Issuer-only TOML would have minimal or no SEP endpoints
      ORG_URL: 'https://moneygram.com',
      ORG_SUPPORT_EMAIL: 'support@moneygram.com',
    };

    const serviceTomlResponse = {
      TRANSFER_SERVER_SEP0024: 'https://api.stellar.moneygram.com/sep24',
      WEB_AUTH_ENDPOINT: 'https://api.stellar.moneygram.com/auth',
      SIGNING_KEY: 'GAMONEYGRAM1234567890',
      ANCHOR_QUOTE_SERVER: 'https://api.stellar.moneygram.com/quotes',
    };

    it('resolves service endpoints from serviceDomain when available', async () => {
      vi.spyOn(StellarToml.Resolver, 'resolve').mockImplementation(async (domain: string) => {
        if (domain === moneygramServiceDomain) {
          return serviceTomlResponse as any;
        }
        return homeTomlResponse as any;
      });

      // Simulating direct service domain resolution
      const result = await resolveToml(moneygramServiceDomain);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.TRANSFER_SERVER_SEP0024).toBe(
          serviceTomlResponse.TRANSFER_SERVER_SEP0024
        );
        expect(result.data.WEB_AUTH_ENDPOINT).toBe(serviceTomlResponse.WEB_AUTH_ENDPOINT);
        expect(result.data.SIGNING_KEY).toBe(serviceTomlResponse.SIGNING_KEY);
        expect(result.data.capabilities.sep24).toBe(true);
        expect(result.data.capabilities.sep10).toBe(true);
        expect(result.data.capabilities.sep38).toBe(true);
      }
    });

    it('does not resolve service endpoints from issuer-only homeDomain', async () => {
      vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(homeTomlResponse as any);

      const result = await resolveToml(moneygramHomeDomain);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.TRANSFER_SERVER_SEP0024).toBeNull();
        expect(result.data.WEB_AUTH_ENDPOINT).toBeNull();
        expect(result.data.capabilities.sep24).toBe(false);
        expect(result.data.capabilities.sep10).toBe(false);
      }
    });

    it('resolves to correct domain when both home and service domains exist', async () => {
      const resolveSpy = vi.spyOn(StellarToml.Resolver, 'resolve');
      resolveSpy.mockImplementation(async (domain: string) => {
        if (domain === moneygramServiceDomain) {
          return serviceTomlResponse as any;
        }
        return homeTomlResponse as any;
      });

      // When resolving the service domain specifically
      const result = await resolveToml(moneygramServiceDomain);

      expect(result.ok).toBe(true);
      expect(resolveSpy).toHaveBeenCalledWith(moneygramServiceDomain);
      if (result.ok) {
        expect(result.data.capabilities.sep24).toBe(true);
        expect(result.data.capabilities.sep10).toBe(true);
      }
    });
  });

  describe('Anchor resolution with serviceDomain', () => {
    const serviceTomlResponse = {
      TRANSFER_SERVER_SEP0024: 'https://api.stellar.moneygram.com/sep24',
      WEB_AUTH_ENDPOINT: 'https://api.stellar.moneygram.com/auth',
      SIGNING_KEY: 'GAMONEYGRAM1234567890',
    };

    it('resolves MoneyGram anchor using serviceDomain', async () => {
      vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(serviceTomlResponse as any);

      const resolved = await getResolvedAnchorById('moneygram');

      expect(resolved.id).toBe('moneygram');
      expect(resolved.name).toBe('MoneyGram');
      expect(resolved.TRANSFER_SERVER_SEP0024).toBe(serviceTomlResponse.TRANSFER_SERVER_SEP0024);
      expect(resolved.WEB_AUTH_ENDPOINT).toBe(serviceTomlResponse.WEB_AUTH_ENDPOINT);
      expect(resolved.capabilities.sep24).toBe(true);
      expect(resolved.capabilities.sep10).toBe(true);
    });

    it('resolves other anchors without serviceDomain using homeDomain', async () => {
      const cowrieTomlResponse = {
        TRANSFER_SERVER_SEP0024: 'https://api.cowrie.exchange/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.cowrie.exchange/auth',
        SIGNING_KEY: 'GACOWRIE1234567890',
      };

      vi.spyOn(StellarToml.Resolver, 'resolve').mockImplementation(async (domain: string) => {
        if (domain === 'cowrie.exchange') {
          return cowrieTomlResponse as any;
        }
        throw new Error(`Unexpected domain: ${domain}`);
      });

      const resolved = await getResolvedAnchorById('cowrie');

      expect(resolved.id).toBe('cowrie');
      expect(resolved.name).toBe('Cowrie Exchange');
      expect(resolved.TRANSFER_SERVER_SEP0024).toBe(cowrieTomlResponse.TRANSFER_SERVER_SEP0024);
    });
  });

  describe('Caching behavior with service domains', () => {
    it('caches service domain resolution independently from home domain', async () => {
      const resolveSpy = vi.spyOn(StellarToml.Resolver, 'resolve');

      const homeResponse = {
        ORG_URL: 'https://example.com',
      };

      const serviceResponse = {
        TRANSFER_SERVER_SEP0024: 'https://api.example.com/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.example.com/auth',
      };

      resolveSpy.mockImplementation(async (domain: string) => {
        if (domain === 'home.example.com') {
          return homeResponse as any;
        }
        if (domain === 'service.example.com') {
          return serviceResponse as any;
        }
        throw new Error(`Unexpected domain: ${domain}`);
      });

      // First call resolves service domain
      const result1 = await resolveToml('service.example.com');
      expect(result1.ok).toBe(true);
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(resolveSpy).toHaveBeenCalledWith('service.example.com');

      // Second call should use cache (no additional network call)
      const result2 = await resolveToml('service.example.com');
      expect(result2.ok).toBe(true);
      expect(resolveSpy).toHaveBeenCalledTimes(1); // Still 1, not 2

      // Resolving home domain is separate cache entry
      const result3 = await resolveToml('home.example.com');
      expect(result3.ok).toBe(true);
      expect(resolveSpy).toHaveBeenCalledTimes(2); // Now it's 2
      expect(resolveSpy).toHaveBeenCalledWith('home.example.com');
    });
  });

  describe('Integration: real-world anchor scenario', () => {
    it('MoneyGram resolves to service endpoints even though serviceDomain is set', async () => {
      const moneygramServiceResponse = {
        TRANSFER_SERVER_SEP0024: 'https://api.stellar.moneygram.com/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.stellar.moneygram.com/auth',
        SIGNING_KEY: 'GAMONEYGRAM1234567890',
        ANCHOR_QUOTE_SERVER: 'https://api.stellar.moneygram.com/quotes',
        ORG_URL: 'https://moneygram.com',
        ORG_SUPPORT_URL: 'https://support.moneygram.com',
      };

      vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(moneygramServiceResponse as any);

      // In the anchor config, MoneyGram now has serviceDomain === homeDomain
      // (both point to stellar.moneygram.com)
      const resolved = await getResolvedAnchorById('moneygram');

      expect(resolved.id).toBe('moneygram');
      expect(resolved.corridors).toContain('usdc-ngn');
      expect(resolved.TRANSFER_SERVER_SEP0024).toBe('https://api.stellar.moneygram.com/sep24');
      expect(resolved.WEB_AUTH_ENDPOINT).toBe('https://api.stellar.moneygram.com/auth');
      expect(resolved.capabilities.sep24).toBe(true);
      expect(resolved.capabilities.sep10).toBe(true);
      expect(resolved.capabilities.sep38).toBe(true);
    });
  });
});
