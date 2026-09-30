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

    expect(ids).toEqual(['cowrie', 'ngnc']);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'cowrie',
        TRANSFER_SERVER_SEP0024: 'https://api.cowrie.exchange/sep24',
        WEB_AUTH_ENDPOINT: 'https://api.cowrie.exchange/auth',
      }),
      expect.objectContaining({
        id: 'ngnc',
        TRANSFER_SERVER_SEP0024: 'https://ngnc.online/sep24',
        WEB_AUTH_ENDPOINT: 'https://ngnc.online/auth',
      }),
    ]);
  });

  it('omits failed anchors instead of throwing', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockRejectedValue(new Error('timeout'));

    await expect(discoverAnchorsForCorridor('usdc-ngn')).resolves.toEqual([]);
  });

  it('validates the discovered corridor asset, not the anchor primary asset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const LOOKALIKE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    const ARS_ISSUER = 'GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS';
    vi.spyOn(StellarToml.Resolver, 'resolve').mockImplementation((domain) =>
      Promise.resolve({
        ...tomlFor(String(domain)),
        // anclap's primary asset (ARS) is fine; its secondary asset (PEN) is an impostor.
        CURRENCIES: [
          { code: 'ARS', issuer: ARS_ISSUER },
          { code: 'PEN', issuer: LOOKALIKE },
        ],
      } as never)
    );

    await discoverAnchorsForCorridor('ars-ars');
    expect(warn).not.toHaveBeenCalled();

    await discoverAnchorsForCorridor('pen-pen');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('anclap advertises a look-alike PEN issuer');
    expect(warn.mock.calls[0]?.[0]).toContain(LOOKALIKE);
  });
});
