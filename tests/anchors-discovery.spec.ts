import { StellarToml } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverAnchorsForCorridor } from '@/lib/stellar/anchors';
import { _clearTomlCache } from '@/lib/stellar/sep1';

const tomlFor = (domain: string) => ({
  TRANSFER_SERVER_SEP0024: `https://${domain}/sep24`,
  WEB_AUTH_ENDPOINT: `https://${domain}/auth`,
  SIGNING_KEY: 'GABCDEF',
  CURRENCIES: [{ code: 'USDC' }],
});

beforeEach(() => {
  _clearTomlCache();
  vi.restoreAllMocks();
});

describe('discoverAnchorsForCorridor', () => {
  it('returns successful usdc-ngn anchor resolutions with populated endpoints', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockImplementation((domain) => {
      if (domain === 'stellar.moneygram.com') {
        return Promise.reject(new Error('not available'));
      }

      return Promise.resolve(tomlFor(String(domain)) as never);
    });

    const result = await discoverAnchorsForCorridor('usdc-ngn');
    const ids = result.map((anchor) => anchor.id);

    expect(ids).toEqual(['cowrie']);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cowrie',
          transferServerSep24: 'https://cowrie.exchange/sep24',
          webAuthEndpoint: 'https://cowrie.exchange/auth',
        }),
      ])
    );
  });

  it('omits failed anchors instead of throwing', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockRejectedValue(new Error('timeout'));

    await expect(discoverAnchorsForCorridor('usdc-ngn')).resolves.toEqual([]);
  });
});
