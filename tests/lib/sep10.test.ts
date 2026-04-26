import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { fetchChallenge, signChallenge, submitChallenge, authenticate } from '@/lib/stellar/sep10';
import * as sep1 from '@/lib/stellar/sep1';

const WEB_AUTH_ENDPOINT = 'https://cowrie.exchange/auth';
const PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789';
const CHALLENGE_XDR = 'AAAAAQAAAAC...';
const SIGNED_XDR = 'AAAAAQAAAAD...';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.test.token';

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(sep1, 'getWebAuthEndpoint').mockResolvedValue(WEB_AUTH_ENDPOINT);
});

async function getFreighter() {
  return await import('@stellar/freighter-api');
}

// ─── fetchChallenge ───────────────────────────────────────────────────────────

describe('fetchChallenge', () => {
  it('constructs the correct challenge URL with the public key', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({
            transaction: CHALLENGE_XDR,
            network_passphrase: Networks.PUBLIC,
          }),
        };
      })
    );

    await fetchChallenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY);
    expect(capturedUrl).toContain(`account=${PUBLIC_KEY}`);
  });

  it('throws when network_passphrase does not match mainnet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: CHALLENGE_XDR,
          network_passphrase: 'Test SDF Network ; September 2015',
        }),
      }))
    );

    await expect(fetchChallenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY)).rejects.toThrow(/wrong network/);
  });

  it('throws when transaction is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ network_passphrase: Networks.PUBLIC }),
      }))
    );

    await expect(fetchChallenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY)).rejects.toThrow(/"transaction"/);
  });

  it('throws when network_passphrase is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transaction: CHALLENGE_XDR }),
      }))
    );

    await expect(fetchChallenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY)).rejects.toThrow(
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
    expect(result).toBe(JWT);
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
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: SIGNED_XDR,
      signerAddress: PUBLIC_KEY,
    });

    const result = await signChallenge(CHALLENGE_XDR, Networks.PUBLIC);
    expect(result).toBe(SIGNED_XDR);
  });

  it('throws "User rejected signing" when Freighter returns an error', async () => {
    const freighter = await getFreighter();
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: '',
      signerAddress: '',
      error: { message: 'User declined', code: -1 },
    });

    await expect(signChallenge(CHALLENGE_XDR, Networks.PUBLIC)).rejects.toThrow(
      'User rejected signing'
    );
  });
});

// ─── authenticate ─────────────────────────────────────────────────────────────

describe('authenticate', () => {
  it('calls fetchChallenge, signChallenge, and submitChallenge in sequence', async () => {
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
          json: async () => ({ transaction: CHALLENGE_XDR, network_passphrase: Networks.PUBLIC }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: JWT }),
        })
    );

    const result = await authenticate('cowrie.exchange', PUBLIC_KEY);

    expect(result.jwt).toBe(JWT);
    expect(result.anchorDomain).toBe('cowrie.exchange');
    expect(result.publicKey).toBe(PUBLIC_KEY);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});
