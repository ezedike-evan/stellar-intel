import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Account,
  Transaction,
  FeeBumpTransaction,
} from '@stellar/stellar-sdk';
import { fetchSep10Challenge, ChallengeError } from '@/lib/stellar/sep10';

// ─── Constants ────────────────────────────────────────────────────────────────

const ANCHOR_DOMAIN = 'cowrie.exchange';
const WEB_AUTH_ENDPOINT = `https://${ANCHOR_DOMAIN}/auth`;
const serverKp = Keypair.random();
const clientKp = Keypair.random();
const PUBLIC_KEY = clientKp.publicKey();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal but fully valid SEP-10 challenge XDR for mainnet. */
function buildChallengeXdr(): string {
  const account = new Account(serverKp.publicKey(), '0');
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(
      Operation.manageData({
        name: `${ANCHOR_DOMAIN} auth`,
        value: Buffer.from(serverKp.sign(Buffer.from(clientKp.publicKey()))),
        source: PUBLIC_KEY,
      })
    )
    .setTimeout(900)
    .build()
    .toEnvelope()
    .toXDR('base64');
}

const CHALLENGE_XDR = buildChallengeXdr();

// ─── Mock anchor server ───────────────────────────────────────────────────────

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ─── Integration: happy path ──────────────────────────────────────────────────

describe('fetchSep10Challenge — integration against mock anchor', () => {
  it('returns a parsed challenge when the mock anchor responds correctly', async () => {
    server.use(
      http.get(WEB_AUTH_ENDPOINT, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('account')).toBe(PUBLIC_KEY);
        expect(url.searchParams.get('home_domain')).toBe(ANCHOR_DOMAIN);
        return HttpResponse.json({
          transaction: CHALLENGE_XDR,
          network_passphrase: Networks.PUBLIC,
        });
      })
    );

    const result = await fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN);

    expect(result.transaction).toBe(CHALLENGE_XDR);
    expect(result.network_passphrase).toBe(Networks.PUBLIC);
    expect(result.parsed).toBeInstanceOf(Transaction);
  });

  it('appends account and home_domain query parameters to the request URL', async () => {
    const capturedParams: Record<string, string> = {};

    server.use(
      http.get(WEB_AUTH_ENDPOINT, ({ request }) => {
        const url = new URL(request.url);
        capturedParams['account'] = url.searchParams.get('account') ?? '';
        capturedParams['home_domain'] = url.searchParams.get('home_domain') ?? '';
        return HttpResponse.json({
          transaction: CHALLENGE_XDR,
          network_passphrase: Networks.PUBLIC,
        });
      })
    );

    await fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN);

    expect(capturedParams['account']).toBe(PUBLIC_KEY);
    expect(capturedParams['home_domain']).toBe(ANCHOR_DOMAIN);
  });
});

// ─── ChallengeError — malformed responses ─────────────────────────────────────

describe('fetchSep10Challenge — malformed responses throw ChallengeError', () => {
  it('throws ChallengeError(FETCH_FAILED) on HTTP 4xx from the anchor', async () => {
    server.use(http.get(WEB_AUTH_ENDPOINT, () => new HttpResponse(null, { status: 403 })));

    const err = await fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(ChallengeError);
    expect((err as ChallengeError).code).toBe('FETCH_FAILED');
  });

  it('throws ChallengeError(FETCH_FAILED) on HTTP 500 from the anchor', async () => {
    server.use(http.get(WEB_AUTH_ENDPOINT, () => new HttpResponse(null, { status: 500 })));

    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN)
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  it('throws ChallengeError(MISSING_FIELD) when "transaction" is absent', async () => {
    server.use(
      http.get(WEB_AUTH_ENDPOINT, () => HttpResponse.json({ network_passphrase: Networks.PUBLIC }))
    );

    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN)
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' });
  });

  it('throws ChallengeError(MISSING_FIELD) when "network_passphrase" is absent', async () => {
    server.use(
      http.get(WEB_AUTH_ENDPOINT, () => HttpResponse.json({ transaction: CHALLENGE_XDR }))
    );

    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN)
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' });
  });

  it('throws ChallengeError(WRONG_NETWORK) when network_passphrase is testnet', async () => {
    server.use(
      http.get(WEB_AUTH_ENDPOINT, () =>
        HttpResponse.json({
          transaction: CHALLENGE_XDR,
          network_passphrase: Networks.TESTNET,
        })
      )
    );

    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN)
    ).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
  });

  it('throws ChallengeError(INVALID_XDR) when transaction field is not valid XDR', async () => {
    server.use(
      http.get(WEB_AUTH_ENDPOINT, () =>
        HttpResponse.json({
          transaction: 'this-is-not-valid-xdr==',
          network_passphrase: Networks.PUBLIC,
        })
      )
    );

    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN)
    ).rejects.toMatchObject({ code: 'INVALID_XDR' });
  });

  it('ChallengeError has name "ChallengeError" and a descriptive message', async () => {
    server.use(http.get(WEB_AUTH_ENDPOINT, () => new HttpResponse(null, { status: 401 })));

    const err = await fetchSep10Challenge(WEB_AUTH_ENDPOINT, PUBLIC_KEY, ANCHOR_DOMAIN).catch(
      (e) => e
    );
    expect(err.name).toBe('ChallengeError');
    expect(err.message).toMatch(/401/);
  });
});
