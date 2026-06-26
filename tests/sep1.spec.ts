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
      expect(result.data.seps.sep6).toBe(true);
      expect(result.data.seps.sep24).toBe(true);
      expect(result.data.seps.sep38).toBe(false);
      expect(result.data.seps.sep31).toBe(false);
      expect(result.data.capabilities.sep6).toBe(true);
    }
  });

  it('sep6=false when only TRANSFER_SERVER_SEP0024 is present (not TRANSFER_SERVER)', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER_SEP0024: 'https://anchor.example.com/sep24',
      WEB_AUTH_ENDPOINT: 'https://anchor.example.com/auth',
      SIGNING_KEY: 'GABCDEF',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await resolveToml('anchor.example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.seps.sep6).toBe(false);
      expect(result.data.seps.sep24).toBe(true);
    }
  });

  it('sep6=true when TRANSFER_SERVER is present', async () => {
    vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue({
      TRANSFER_SERVER: 'https://anchor.example.com/sep6',
      WEB_AUTH_ENDPOINT: 'https://anchor.example.com/auth',
      SIGNING_KEY: 'GABCDEF',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await resolveToml('sep6only.example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.seps.sep6).toBe(true);
      expect(result.data.seps.sep24).toBe(false);
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
      expect(result.data.seps.sep24).toBe(true);
      expect(result.data.seps.sep31).toBe(true);
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
      seps: { sep6: true, sep24: false, sep38: false, sep31: true },
    });

    const result = await resolveToml('seeded.example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.seps.sep6).toBe(true);
      expect(result.data.seps.sep31).toBe(true);
    }
  });
});
