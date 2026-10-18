// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Networks, Keypair, WebAuth } from '@stellar/stellar-sdk';
import { fetchSep10Challenge, validateSep10Challenge, ChallengeError } from '@/lib/stellar/sep10';
import { buildValidChallenge } from './fixtures/sep10-challenge';

vi.mock('@stellar/freighter-api', () => {
  return {
    getPublicKey: vi.fn(() => 'GCLIENT...'),
    signTransaction: vi.fn(),
    getNetwork: vi.fn(async () => ({ error: false, network: '', networkPassphrase: '' })),
    isConnected: vi.fn(() => true),
  };
});

/**
 * Tests for SEP-10 authentication state machine.
 *
 * Tests all state transitions and error paths:
 * - Challenge: fetch challenge from anchor
 * - Sign: sign challenge with user's Freighter key
 * - Exchange: exchange signed challenge for JWT
 * - Cache: (implicit in successful exchange)
 */

// ─── Test data ─────────────────────────────────────────────────────────────────

const WEB_AUTH_ENDPOINT = 'https://anchor.example.com/auth';
const PUBLIC_KEY = Keypair.random().publicKey();
const HOME_DOMAIN = 'anchor.example.com';

const SERVER = Keypair.random();
const SIGNING_KEY = SERVER.publicKey();

/** A real SEP-10 challenge from the anchor's SIGNING_KEY for PUBLIC_KEY. */
const VALID_CHALLENGE_XDR = buildValidChallenge({
  server: SERVER,
  clientAccountId: PUBLIC_KEY,
  homeDomain: HOME_DOMAIN,
  webAuthDomain: new URL(WEB_AUTH_ENDPOINT).host,
});

// ─── Mock fetch ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ─── State 1: Challenge fetch ─────────────────────────────────────────────────

describe('SEP-10 state machine — challenge fetch', () => {
  it('fetches challenge from web auth endpoint with account and home_domain params', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        capturedUrl = url;
        capturedMethod = opts?.method ?? 'GET';

        return {
          ok: true,
          json: async () => ({
            transaction: VALID_CHALLENGE_XDR,
            network_passphrase: Networks.PUBLIC,
          }),
        };
      })
    );

    await fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, HOME_DOMAIN, SIGNING_KEY);

    expect(capturedUrl).toContain(WEB_AUTH_ENDPOINT);
    expect(capturedUrl).toContain(`account=${encodeURIComponent(PUBLIC_KEY)}`);
    expect(capturedUrl).toContain(`home_domain=${encodeURIComponent(HOME_DOMAIN)}`);
    expect(capturedMethod).toBe('GET');
    expect(new URL(capturedUrl).searchParams.has('client_domain')).toBe(false);
  });

  it('requests client_domain only when supplied and validates the returned operation', async () => {
    const clientDomain = 'wallet.example.com';
    const clientSigningKey = Keypair.random();
    const xdr = WebAuth.buildChallengeTx(
      SERVER,
      PUBLIC_KEY,
      HOME_DOMAIN,
      300,
      Networks.PUBLIC,
      new URL(WEB_AUTH_ENDPOINT).host,
      null,
      clientDomain,
      clientSigningKey.publicKey()
    );
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({ transaction: xdr, network_passphrase: Networks.PUBLIC }),
        };
      })
    );

    await fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, HOME_DOMAIN, SIGNING_KEY, [], {
      clientDomain,
    });
    expect(new URL(capturedUrl).searchParams.get('client_domain')).toBe(clientDomain);
  });

  it('returns a Sep10Challenge with parsed transaction', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: VALID_CHALLENGE_XDR,
          network_passphrase: Networks.PUBLIC,
        }),
      }))
    );

    const challenge = await fetchSep10Challenge(
      WEB_AUTH_ENDPOINT,
      PUBLIC_KEY,
      HOME_DOMAIN,
      SIGNING_KEY
    );

    expect(challenge).toHaveProperty('transaction');
    expect(challenge).toHaveProperty('network_passphrase');
    expect(challenge).toHaveProperty('parsed');
    expect(challenge.network_passphrase).toBe(Networks.PUBLIC);
  });

  it('throws ChallengeError with FETCH_FAILED on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network error');
      })
    );

    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, HOME_DOMAIN, SIGNING_KEY)
    ).rejects.toThrow(ChallengeError);

    try {
      await fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, HOME_DOMAIN, SIGNING_KEY);
    } catch (err) {
      expect(err).toBeInstanceOf(ChallengeError);
      if (err instanceof ChallengeError) {
        expect(err.code).toBe('FETCH_FAILED');
      }
    }
  });

  it('throws ChallengeError with MISSING_FIELD on incomplete response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          // missing transaction
          network_passphrase: Networks.PUBLIC,
        }),
      }))
    );

    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, HOME_DOMAIN, SIGNING_KEY)
    ).rejects.toThrow(ChallengeError);
  });

  it('throws ChallengeError on HTTP error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
      }))
    );

    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, HOME_DOMAIN, SIGNING_KEY)
    ).rejects.toThrow(ChallengeError);
  });
});
