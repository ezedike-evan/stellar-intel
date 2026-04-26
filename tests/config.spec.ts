import { describe, it, expect } from 'vitest';
import { Horizon } from '@stellar/stellar-sdk';
import { config, getHorizonServer, NETWORK_PASSPHRASE, HORIZON_URL } from '@/lib/config';

describe('getHorizonServer', () => {
  it('returns a Horizon.Server instance', () => {
    expect(getHorizonServer()).toBeInstanceOf(Horizon.Server);
  });

  it('server URL is derived from NEXT_PUBLIC_HORIZON_URL, not a hardcoded literal', () => {
    const server = getHorizonServer();
    // Stellar SDK normalises the URL with a trailing slash
    const normalised = config.horizonUrl.endsWith('/')
      ? config.horizonUrl
      : `${config.horizonUrl}/`;
    expect(server.serverURL.toString()).toBe(normalised);
  });

  it('each call returns a fresh independent instance', () => {
    expect(getHorizonServer()).not.toBe(getHorizonServer());
  });
});

describe('NETWORK_PASSPHRASE', () => {
  it('matches the network set in NEXT_PUBLIC_STELLAR_NETWORK', () => {
    const passphrases: Record<string, string> = {
      mainnet: 'Public Global Stellar Network ; September 2015',
      testnet: 'Test SDF Network ; September 2015',
      futurenet: 'Test SDF Future Network ; October 2022',
    };
    expect(NETWORK_PASSPHRASE).toBe(passphrases[config.stellarNetwork]);
  });
});

describe('HORIZON_URL named export', () => {
  it('re-exports config.horizonUrl so all callers share one source', () => {
    expect(HORIZON_URL).toBe(config.horizonUrl);
  });

  it('contains no hardcoded fallback — value comes from env', () => {
    expect(HORIZON_URL).toBe(process.env.NEXT_PUBLIC_HORIZON_URL);
  });
});
