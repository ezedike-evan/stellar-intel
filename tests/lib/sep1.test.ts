import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Networks, StellarToml } from '@stellar/stellar-sdk';
import {
  resolveAnchor,
  resolveToml,
  getTransferServer,
  getWebAuthEndpoint,
  resolveAllAnchors,
  resolveAnchorSupportHref,
  _clearTomlCache,
} from '@/lib/stellar/sep1';

const VALID_TOML = {
  TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
  ANCHOR_QUOTE_SERVER: 'https://cowrie.exchange/quotes',
  WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
  SIGNING_KEY: 'GABCDEF',
  NETWORK_PASSPHRASE: Networks.PUBLIC,
  CURRENCIES: [
    { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
  ],
};

beforeEach(() => {
  _clearTomlCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveAnchor', () => {
  it('calls StellarToml.Resolver.resolve and extracts SEP-1 fields', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never);

    const result = await resolveAnchor('cowrie.exchange');

    expect(spy).toHaveBeenCalledWith('cowrie.exchange');
    expect(result).toEqual({
      domain: 'cowrie.exchange',
      TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
      ANCHOR_QUOTE_SERVER: 'https://cowrie.exchange/quotes',
      WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
      SIGNING_KEY: 'GABCDEF',
      NETWORK_PASSPHRASE: Networks.PUBLIC,
      ORG_URL: null,
      ORG_SUPPORT_EMAIL: null,
      ORG_SUPPORT_URL: null,
      CURRENCIES: [
        { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
      ],
      capabilities: {
        sep10: true,
        sep24: true,
        sep38: true,
        sep12: true,
      },
    });
  });

  it('normalizes domain casing for cache keys', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never);

    await resolveAnchor(' Cowrie.Exchange ');
    await resolveAnchor('cowrie.exchange');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('cowrie.exchange');
  });

  it('returns nullable fields when optional TOML values are absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({} as never);

    const result = await resolveAnchor('cowrie.exchange');

    expect(result.TRANSFER_SERVER_SEP0024).toBeNull();
    expect(result.ANCHOR_QUOTE_SERVER).toBeNull();
    expect(result.WEB_AUTH_ENDPOINT).toBeNull();
    expect(result.SIGNING_KEY).toBeNull();
    expect(result.NETWORK_PASSPHRASE).toBeNull();
    expect(result.ORG_URL).toBeNull();
    expect(result.ORG_SUPPORT_EMAIL).toBeNull();
    expect(result.ORG_SUPPORT_URL).toBeNull();
    expect(result.CURRENCIES).toEqual([]);
  });

  it('extracts ORG_SUPPORT_URL when present in TOML', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      ...VALID_TOML,
      ORG_SUPPORT_URL: 'https://support.cowrie.exchange',
    } as never);

    const result = await resolveAnchor('cowrie.exchange');
    expect(result.ORG_SUPPORT_URL).toBe('https://support.cowrie.exchange');
  });

  it('extracts ORG_SUPPORT_EMAIL when present in TOML', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      ...VALID_TOML,
      ORG_SUPPORT_EMAIL: 'support@cowrie.exchange',
    } as never);

    const result = await resolveAnchor('cowrie.exchange');
    expect(result.ORG_SUPPORT_EMAIL).toBe('support@cowrie.exchange');
  });

  it('sets sep24 false and sep10 true when TRANSFER_SERVER_SEP0024 is absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
    } as never);

    const result = await resolveAnchor('cowrie.exchange');

    expect(result.capabilities.sep24).toBe(false);
    expect(result.capabilities.sep10).toBe(true);
    expect(result.TRANSFER_SERVER_SEP0024).toBeNull();
  });

  it('sets sep10 false and sep24 true when WEB_AUTH_ENDPOINT is absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
    } as never);

    const result = await resolveAnchor('cowrie.exchange');

    expect(result.capabilities.sep10).toBe(false);
    expect(result.capabilities.sep24).toBe(true);
    expect(result.WEB_AUTH_ENDPOINT).toBeNull();
  });

  it('throws a descriptive error when the network call fails', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockRejectedValue(new Error('Network timeout'));

    await expect(resolveAnchor('cowrie.exchange')).rejects.toThrow(
      /Failed to resolve stellar\.toml for "cowrie\.exchange"/
    );
  });

  it('returns a cache hit in under 1ms', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never);

    await resolveAnchor('cowrie.exchange');

    const startedAt = performance.now();
    const cached = await resolveAnchor('cowrie.exchange');
    const elapsedMs = performance.now() - startedAt;

    expect(cached.WEB_AUTH_ENDPOINT).toBe('https://cowrie.exchange/auth');
    expect(elapsedMs).toBeLessThan(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cached TOML after the 15-minute TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const spy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValueOnce(VALID_TOML as never)
      .mockResolvedValueOnce({
        ...VALID_TOML,
        WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/new-auth',
      } as never);

    await resolveAnchor('cowrie.exchange');
    vi.setSystemTime(new Date('2026-01-01T00:15:00.001Z'));

    const refreshed = await resolveAnchor('cowrie.exchange');

    expect(refreshed.WEB_AUTH_ENDPOINT).toBe('https://cowrie.exchange/new-auth');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('resolveToml', () => {
  it('returns ok:true with data on success', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never);

    const result = await resolveToml('cowrie.exchange');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ANCHOR_QUOTE_SERVER).toBe('https://cowrie.exchange/quotes');
      expect(result.data.TRANSFER_SERVER_SEP0024).toBe('https://cowrie.exchange/sep24');
      expect(result.data.WEB_AUTH_ENDPOINT).toBe('https://cowrie.exchange/auth');
    }
  });

  it('returns ok:false with error message on failure', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockRejectedValue(new Error('Network timeout'));

    const result = await resolveToml('cowrie.exchange');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Failed to resolve stellar\.toml for "cowrie\.exchange"/);
    }
  });
});

describe('getTransferServer', () => {
  it('returns the transfer server URL', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never);

    const url = await getTransferServer('cowrie.exchange');
    expect(url).toBe('https://cowrie.exchange/sep24');
  });

  it('throws when TRANSFER_SERVER_SEP0024 is absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
    } as never);

    await expect(getTransferServer('cowrie.exchange')).rejects.toThrow(
      /Missing TRANSFER_SERVER_SEP0024.*"cowrie\.exchange"/
    );
  });
});

describe('getWebAuthEndpoint', () => {
  it('returns the web auth endpoint URL', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never);

    const url = await getWebAuthEndpoint('cowrie.exchange');
    expect(url).toBe('https://cowrie.exchange/auth');
  });

  it('throws when WEB_AUTH_ENDPOINT is absent', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
    } as never);

    await expect(getWebAuthEndpoint('cowrie.exchange')).rejects.toThrow(
      /Missing WEB_AUTH_ENDPOINT.*"cowrie\.exchange"/
    );
  });
});

describe('resolveAllAnchors', () => {
  it('calls resolve for each anchor in ANCHORS', async () => {
    const spy = vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(VALID_TOML as never);

    await resolveAllAnchors();

    // ANCHORS has 3 entries: moneygram, cowrie, anclap
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('returns partial results when one anchor fails', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockImplementation((domain) => {
      if (domain === 'anclap.com') return Promise.reject(new Error('timeout'));
      return Promise.resolve(VALID_TOML as never);
    });

    const result = await resolveAllAnchors();
    expect(result['moneygram']).toBeDefined();
    expect(result['moneygram']?.homeDomain).toBe('stellar.moneygram.com');
    expect(result['moneygram']?.TRANSFER_SERVER_SEP0024).toBe('https://cowrie.exchange/sep24');
    expect(result['cowrie']).toBeDefined();
    expect(result['anclap']).toBeUndefined();
  });
});

describe('resolveAnchorSupportHref', () => {
  it('prefers ORG_SUPPORT_URL over email', () => {
    const href = resolveAnchorSupportHref({
      domain: 'cowrie.exchange',
      TRANSFER_SERVER_SEP0024: null,
      ANCHOR_QUOTE_SERVER: null,
      WEB_AUTH_ENDPOINT: null,
      SIGNING_KEY: null,
      NETWORK_PASSPHRASE: null,
      ORG_URL: 'https://www.cowrie.exchange',
      ORG_SUPPORT_EMAIL: 'support@cowrie.exchange',
      ORG_SUPPORT_URL: 'https://support.cowrie.exchange',
      CURRENCIES: [],
      capabilities: { sep10: false, sep24: false, sep38: false, sep12: false },
    });
    expect(href).toBe('https://support.cowrie.exchange');
  });

  it('returns mailto for ORG_SUPPORT_EMAIL when no support URL', () => {
    const href = resolveAnchorSupportHref({
      domain: 'cowrie.exchange',
      TRANSFER_SERVER_SEP0024: null,
      ANCHOR_QUOTE_SERVER: null,
      WEB_AUTH_ENDPOINT: null,
      SIGNING_KEY: null,
      NETWORK_PASSPHRASE: null,
      ORG_URL: 'https://www.cowrie.exchange',
      ORG_SUPPORT_EMAIL: 'support@cowrie.exchange',
      ORG_SUPPORT_URL: null,
      CURRENCIES: [],
      capabilities: { sep10: false, sep24: false, sep38: false, sep12: false },
    });
    expect(href).toBe('mailto:support@cowrie.exchange');
  });

  it('falls back to https ORG_URL when email and support URL are absent', () => {
    const href = resolveAnchorSupportHref({
      domain: 'cowrie.exchange',
      TRANSFER_SERVER_SEP0024: null,
      ANCHOR_QUOTE_SERVER: null,
      WEB_AUTH_ENDPOINT: null,
      SIGNING_KEY: null,
      NETWORK_PASSPHRASE: null,
      ORG_URL: 'https://www.cowrie.exchange',
      ORG_SUPPORT_EMAIL: null,
      ORG_SUPPORT_URL: null,
      CURRENCIES: [],
      capabilities: { sep10: false, sep24: false, sep38: false, sep12: false },
    });
    expect(href).toBe('https://www.cowrie.exchange');
  });
});
