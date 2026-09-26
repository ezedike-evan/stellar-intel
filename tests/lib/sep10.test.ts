import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  fetchSep10Challenge,
  signChallenge,
  submitChallenge,
  authenticate,
  validateSep10Challenge,
  NetworkMismatchError,
} from '@/lib/stellar/sep10';
import type { Sep10Challenge } from '@/lib/stellar/sep10';
import { buildValidChallenge } from '../fixtures/sep10-challenge';

const HOME_DOMAIN = 'cowrie.exchange';
const WEB_AUTH_ENDPOINT = 'https://cowrie.exchange/auth';
const SERVER = Keypair.random();
const PUBLIC_KEY = Keypair.random().publicKey();
const SIGNED_XDR = 'AAAAAQAAAAD...';

/** A real challenge from SERVER for PUBLIC_KEY, built fresh so its timebounds are current. */
function challengeXdr(): string {
  return buildValidChallenge({
    server: SERVER,
    clientAccountId: PUBLIC_KEY,
    homeDomain: HOME_DOMAIN,
    webAuthDomain: new URL(WEB_AUTH_ENDPOINT).host,
  });
}

function validatedChallenge(): Sep10Challenge {
  return validateSep10Challenge(
    challengeXdr(),
    Networks.PUBLIC,
    {
      serverSigningKey: SERVER.publicKey(),
      homeDomains: HOME_DOMAIN,
      webAuthEndpoint: WEB_AUTH_ENDPOINT,
      clientAccountId: PUBLIC_KEY,
    },
    HOME_DOMAIN
  );
}

function fetchCowrieChallenge(endpoint: string, publicKey: string) {
  return fetchSep10Challenge(endpoint, publicKey, HOME_DOMAIN, SERVER.publicKey());
}
function makeJwt(expSeconds: number): string {
  const b64 = (s: string) => btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ exp: expSeconds }));
  return `${header}.${payload}.signature`;
}

const EXP_TIMESTAMP = Math.floor(Date.now() / 1000) + 3600;
const JWT = makeJwt(EXP_TIMESTAMP);
const EXP_DATE = new Date(EXP_TIMESTAMP * 1000);

const MOCK_RESOLVED_ANCHOR = {
  id: 'cowrie',
  name: 'Cowrie',
  homeDomain: 'cowrie.exchange',
  corridors: [],
  assetCode: 'USDC',
  assetIssuer: 'G...',
  TRANSFER_SERVER_SEP0024: 'https://cowrie.exchange/sep24',
  WEB_AUTH_ENDPOINT: WEB_AUTH_ENDPOINT,
  SIGNING_KEY: SERVER.publicKey(),
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
  domain: HOME_DOMAIN,
  ANCHOR_QUOTE_SERVER: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
};

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
  getNetwork: vi.fn(async () => ({ error: false, network: '', networkPassphrase: '' })),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

async function getFreighter() {
  return await import('@stellar/freighter-api');
}

// ─── fetchSep10Challenge ──────────────────────────────────────────────────────

describe('fetchSep10Challenge', () => {
  it('constructs the correct challenge URL with the public key', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({
            transaction: challengeXdr(),
            network_passphrase: Networks.PUBLIC,
          }),
        };
      })
    );

    await fetchCowrieChallenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY);
    expect(capturedUrl).toContain(`account=${PUBLIC_KEY}`);
  });

  it('throws when network_passphrase does not match mainnet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: challengeXdr(),
          network_passphrase: 'Test SDF Network ; September 2015',
        }),
      }))
    );

    await expect(fetchCowrieChallenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY)).rejects.toThrow(
      /wrong network/
    );
  });

  it('throws when transaction is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ network_passphrase: Networks.PUBLIC }),
      }))
    );

    await expect(fetchCowrieChallenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY)).rejects.toThrow(
      /"transaction"/
    );
  });

  it('throws when network_passphrase is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transaction: challengeXdr() }),
      }))
    );

    await expect(fetchCowrieChallenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY)).rejects.toThrow(
      /"network_passphrase"/
    );
  });
});

// ─── submitChallenge ──────────────────────────────────────────────────────────

describe('submitChallenge', () => {
  it('extracts the JWT from the anchor response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: JWT }),
      }))
    );

    const result = await submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR);
    expect(result.token).toBe(JWT);
    expect(result.expiresAt).toEqual(EXP_DATE);
  });

  it('throws when token is absent from the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ other: 'data' }),
      }))
    );

    await expect(submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR)).rejects.toThrow(/"token"/);
  });
});

// ─── signChallenge ────────────────────────────────────────────────────────────

describe('signChallenge', () => {
  it('returns the signed XDR from Freighter', async () => {
    const freighter = await getFreighter();
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: Networks.PUBLIC,
    });
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: SIGNED_XDR,
      signerAddress: PUBLIC_KEY,
    });

    const result = await signChallenge(validatedChallenge());
    expect(result).toBe(SIGNED_XDR);
  });

  it('throws NetworkMismatchError without signing when Freighter is on the wrong network', async () => {
    const freighter = await getFreighter();
    vi.mocked(freighter.signTransaction).mockClear();
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: Networks.TESTNET,
    });

    await expect(signChallenge(validatedChallenge())).rejects.toBeInstanceOf(NetworkMismatchError);
    expect(freighter.signTransaction).not.toHaveBeenCalled();
  });

  it('names both networks in the mismatch guidance', async () => {
    const freighter = await getFreighter();
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: Networks.TESTNET,
    });

    await expect(signChallenge(validatedChallenge())).rejects.toThrow(
      /Switch network in Freighter to Mainnet \(Public\).*currently set to Testnet/
    );
  });

  it('proceeds to sign when Freighter network cannot be read', async () => {
    const freighter = await getFreighter();
    vi.mocked(freighter.getNetwork).mockRejectedValue(new Error('extension unavailable'));
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: SIGNED_XDR,
      signerAddress: PUBLIC_KEY,
    });

    const result = await signChallenge(validatedChallenge());
    expect(result).toBe(SIGNED_XDR);
  });

  it('throws "User rejected signing" when Freighter returns an error', async () => {
    const freighter = await getFreighter();
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: Networks.PUBLIC,
    });
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: '',
      signerAddress: '',
      error: { message: 'User declined', code: -1 },
    });

    await expect(signChallenge(validatedChallenge())).rejects.toThrow('User rejected the request');
  });
});

// ─── authenticate ─────────────────────────────────────────────────────────────

describe('authenticate', () => {
  it('calls fetchSep10Challenge, signChallenge, and submitChallenge in sequence', async () => {
    const freighter = await getFreighter();
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: SIGNED_XDR,
      signerAddress: PUBLIC_KEY,
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ transaction: challengeXdr(), network_passphrase: Networks.PUBLIC }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: JWT }),
        })
    );

    const result = await authenticate(MOCK_RESOLVED_ANCHOR, PUBLIC_KEY);

    expect(result.jwt).toBe(JWT);
    expect(result.anchorDomain).toBe('cowrie.exchange');
    expect(result.publicKey).toBe(PUBLIC_KEY);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});
