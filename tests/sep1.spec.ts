import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StellarToml } from '@stellar/stellar-sdk';
import { resolveToml, _clearTomlCache, _seedTomlCache } from '@/lib/stellar/sep1';

describe('SEP-1 seps capability flags', () => {
  beforeEach(() => {
    _clearTomlCache();
    vi.restoreAllMocks();
  });

  it('Cowrie: sep6=true and sep24=true when both servers present', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER_SEP0024: 'https://api.cowrie.exchange/sep24',
      TRANSFER_SERVER: 'https://api.cowrie.exchange/sep6',
      WEB_AUTH_ENDPOINT: 'https://api.cowrie.exchange/auth',
      SIGNING_KEY: 'GAYOLLLUIZNCXT667S6H6XGIZ664S2I2OTXF2SNC6W56F35J5XNQUU7B',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await resolveToml('cowrie.exchange');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.seps).toContain('sep6');
      expect(result.data.seps).toContain('sep24');
      expect(result.data.seps).not.toContain('sep38');
      expect(result.data.seps).not.toContain('sep31');
      expect(result.data.capabilities.sep6).toBe(true);
    }
  });

  it('sep6=false when only TRANSFER_SERVER_SEP0024 is present (not TRANSFER_SERVER)', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER_SEP0024: 'https://api.cowrie.exchange/sep24',
      WEB_AUTH_ENDPOINT: 'https://api.cowrie.exchange/auth',
      SIGNING_KEY: 'GABCDEF',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await resolveToml('anchor.example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.seps).not.toContain('sep6');
      expect(result.data.seps).toContain('sep24');
    }
  });

  it('sep6=true when TRANSFER_SERVER is present', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER: 'https://api.cowrie.exchange/sep6',
      WEB_AUTH_ENDPOINT: 'https://api.cowrie.exchange/auth',
      SIGNING_KEY: 'GABCDEF',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await resolveToml('sep6only.example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.seps).toContain('sep6');
      expect(result.data.seps).not.toContain('sep24');
    }
  });

  it('sep31=true when DIRECT_PAYMENT_SERVER is present', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER_SEP0024: 'https://anclap.com/sep24',
      DIRECT_PAYMENT_SERVER: 'https://anclap.com/sep31',
      WEB_AUTH_ENDPOINT: 'https://anclap.com/auth',
      SIGNING_KEY: 'GANCLAP',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await resolveToml('anclap.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.seps).toContain('sep24');
      expect(result.data.seps).toContain('sep31');
      expect(result.data.capabilities.sep31).toBe(true);
    }
  });

  it('_seedTomlCache injects data that resolveToml returns directly', async () => {
    _seedTomlCache('seeded.example.com', {
      domain: 'seeded.example.com',
      TRANSFER_SERVER_SEP0024: null,
      TRANSFER_SERVER: 'https://seeded.example.com/sep6',
      DIRECT_PAYMENT_SERVER: 'https://seeded.example.com/sep31',
      ANCHOR_QUOTE_SERVER: null,
      WEB_AUTH_ENDPOINT: null,
      SIGNING_KEY: null,
      NETWORK_PASSPHRASE: null,
      ORG_URL: null,
      ORG_SUPPORT_EMAIL: null,
      ORG_SUPPORT_URL: null,
      CURRENCIES: [],
      capabilities: {
        sep10: false,
        sep24: false,
        sep38: false,
        sep12: false,
        sep6: true,
        sep31: true,
      },
      seps: ['sep6', 'sep31'],
    });

    const result = await resolveToml('seeded.example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.seps).toContain('sep6');
      expect(result.data.seps).toContain('sep31');
    }
  });
});

describe('SEP-1 server URL filtering (#1353)', () => {
  beforeEach(() => {
    _clearTomlCache();
    vi.restoreAllMocks();
  });

  async function resolve(toml: Record<string, string>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(toml as any);
    const result = await resolveToml('cowrie.exchange');
    if (!result.ok) throw new Error('expected an ok result');
    return result.data;
  }

  it('drops an http:// TRANSFER_SERVER_SEP0024 and clears the sep24 capability', async () => {
    const data = await resolve({
      TRANSFER_SERVER_SEP0024: 'http://api.cowrie.exchange/sep24',
      WEB_AUTH_ENDPOINT: 'https://api.cowrie.exchange/auth',
    });
    expect(data.TRANSFER_SERVER_SEP0024).toBeNull();
    expect(data.capabilities.sep24).toBe(false);
    expect(data.seps).not.toContain('sep24');
    expect(data.capabilities.sep10).toBe(true);
  });

  it('drops a metadata-host ANCHOR_QUOTE_SERVER and clears the sep38 capability', async () => {
    const data = await resolve({ ANCHOR_QUOTE_SERVER: 'https://169.254.169.254/' });
    expect(data.ANCHOR_QUOTE_SERVER).toBeNull();
    expect(data.capabilities.sep38).toBe(false);
  });

  it('drops every other server key that points off the registry', async () => {
    const data = await resolve({
      TRANSFER_SERVER: 'https://evil.example.com/sep6',
      DIRECT_PAYMENT_SERVER: 'https://localhost/sep31',
      WEB_AUTH_ENDPOINT: 'https://cowrie.exchange.evil.com/auth',
    });
    expect(data.TRANSFER_SERVER).toBeNull();
    expect(data.DIRECT_PAYMENT_SERVER).toBeNull();
    expect(data.WEB_AUTH_ENDPOINT).toBeNull();
    expect(data.capabilities).toMatchObject({ sep6: false, sep31: false, sep10: false });
  });

  it('logs the rejection by key, never the URL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await resolve({ TRANSFER_SERVER_SEP0024: 'https://evil.example.com/secret-path?token=abc' });

    expect(warn).toHaveBeenCalledWith(
      '[sep1] server URL rejected',
      expect.objectContaining({ event: 'sep1_server_url_rejected', key: 'TRANSFER_SERVER_SEP0024' })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('evil.example.com');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('token=abc');
  });

  it('keeps an https URL on a registry subdomain', async () => {
    const data = await resolve({
      TRANSFER_SERVER_SEP0024: 'https://edge.api.cowrie.exchange/sep24',
    });
    expect(data.TRANSFER_SERVER_SEP0024).toBe('https://edge.api.cowrie.exchange/sep24');
    expect(data.capabilities.sep24).toBe(true);
  });
});
