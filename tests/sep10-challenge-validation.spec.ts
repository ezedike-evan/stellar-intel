// @vitest-environment node
/**
 * H-2: the SEP-10 challenge must be verified before it reaches Freighter.
 * Every case here drives the real `authenticate()` flow with a challenge built
 * by the SDK, and the negative cases assert Freighter was never asked to sign.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair, Memo, Networks, Operation } from '@stellar/stellar-sdk';
import {
  authenticate,
  fetchSep10Challenge,
  signChallenge,
  validateSep10Challenge,
  ChallengeError,
  Sep10ChallengeRejectedError,
} from '@/lib/stellar/sep10';
import type { Sep10Challenge } from '@/lib/stellar/sep10';
import { clearJwtCache } from '@/lib/stellar/jwt-cache';
import { classifyExecuteError, isRetryableExecuteError } from '@/lib/errors/messages';
import type { ResolvedAnchor } from '@/types';
import {
  buildCustomChallenge,
  buildValidChallenge,
  drainPayment,
} from './fixtures/sep10-challenge';

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
  getNetwork: vi.fn(async () => ({ error: false, network: '', networkPassphrase: '' })),
}));

const HOME_DOMAIN = 'anchor.example.com';
const WEB_AUTH_ENDPOINT = 'https://auth.anchor.example.com/sep10';
const WEB_AUTH_DOMAIN = 'auth.anchor.example.com';

const server = Keypair.random();
const client = Keypair.random();
const attacker = Keypair.random();

function makeJwt(expSeconds: number): string {
  const b64 = (s: string) => btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64(JSON.stringify({ alg: 'HS256' }))}.${b64(JSON.stringify({ exp: expSeconds }))}.sig`;
}

function anchor(overrides: Partial<ResolvedAnchor> = {}): ResolvedAnchor {
  return {
    id: 'example',
    name: 'Example Anchor',
    homeDomain: HOME_DOMAIN,
    domain: HOME_DOMAIN,
    corridors: [],
    assetCode: 'USDC',
    assetIssuer: attacker.publicKey(),
    TRANSFER_SERVER_SEP0024: `https://${HOME_DOMAIN}/sep24`,
    WEB_AUTH_ENDPOINT,
    SIGNING_KEY: server.publicKey(),
    ANCHOR_QUOTE_SERVER: null,
    NETWORK_PASSPHRASE: null,
    ORG_URL: null,
    ORG_SUPPORT_EMAIL: null,
    ORG_SUPPORT_URL: null,
    CURRENCIES: [],
    capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
    ...overrides,
  } as ResolvedAnchor;
}

function stubAnchor(challengeXdr: string, networkPassphrase: string = Networks.PUBLIC) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ token: makeJwt(Math.floor(Date.now() / 1000) + 3600) }),
      };
    }
    return {
      ok: true,
      json: async () => ({ transaction: challengeXdr, network_passphrase: networkPassphrase }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function valid(overrides: { homeDomain?: string; webAuthDomain?: string } = {}): string {
  return buildValidChallenge({
    server,
    clientAccountId: client.publicKey(),
    homeDomain: overrides.homeDomain ?? HOME_DOMAIN,
    webAuthDomain: overrides.webAuthDomain ?? WEB_AUTH_DOMAIN,
  });
}

async function freighter() {
  return await import('@stellar/freighter-api');
}

/** Runs authenticate() and returns the rejection, asserting nothing was signed. */
async function expectRefused(a: ResolvedAnchor): Promise<Sep10ChallengeRejectedError> {
  const f = await freighter();
  const err = await authenticate(a, client.publicKey()).then(
    () => {
      throw new Error('authenticate() resolved but should have refused the challenge');
    },
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(Sep10ChallengeRejectedError);
  expect(f.signTransaction).not.toHaveBeenCalled();
  return err as Sep10ChallengeRejectedError;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearJwtCache();
  const f = await freighter();
  vi.mocked(f.signTransaction).mockImplementation(async (xdr: string) => ({
    signedTxXdr: xdr,
    signerAddress: client.publicKey(),
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SEP-10 challenge validation — accepts', () => {
  it('signs a spec-conformant challenge and exchanges it for a JWT', async () => {
    const xdr = valid();
    const fetchMock = stubAnchor(xdr);
    const f = await freighter();

    const auth = await authenticate(anchor(), client.publicKey());

    expect(auth.anchorDomain).toBe(HOME_DOMAIN);
    expect(f.signTransaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.signTransaction).mock.calls[0]?.[0]).toBe(xdr);
    const challengeUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(challengeUrl.searchParams.get('home_domain')).toBe(HOME_DOMAIN);
    expect(challengeUrl.searchParams.get('account')).toBe(client.publicKey());
  });

  it('returns the parsed challenge with the matched home domain and client account', () => {
    const challenge = validateSep10Challenge(
      valid(),
      Networks.PUBLIC,
      {
        serverSigningKey: server.publicKey(),
        homeDomains: HOME_DOMAIN,
        webAuthEndpoint: WEB_AUTH_ENDPOINT,
        clientAccountId: client.publicKey(),
      },
      HOME_DOMAIN
    );
    expect(challenge.homeDomain).toBe(HOME_DOMAIN);
    expect(challenge.clientAccountID).toBe(client.publicKey());
    expect(challenge.parsed.sequence).toBe('0');
  });

  it('accepts a challenge naming the registry homeDomain when the toml lives on a service domain', async () => {
    stubAnchor(valid({ homeDomain: 'issuer.example.com' }));
    const auth = await authenticate(
      anchor({ homeDomain: 'issuer.example.com', domain: HOME_DOMAIN }),
      client.publicKey()
    );
    expect(auth.anchorDomain).toBe('issuer.example.com');
  });
});

describe('SEP-10 challenge validation — rejects', () => {
  it('rejects a non-zero sequence number', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        sequence: 42n,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
      })
    );
    const err = await expectRefused(anchor());
    expect(err.reason).toBe('INVALID_CHALLENGE');
    expect(err.detail).toMatch(/sequence number is not zero/);
  });

  it("rejects a challenge whose source is not the toml's SIGNING_KEY", async () => {
    // Well-formed and self-signed, but by a key the anchor never published.
    stubAnchor(
      buildValidChallenge({
        server: attacker,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
      })
    );
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/source is not the anchor's SIGNING_KEY/);
  });

  it('rejects a challenge not signed by the SIGNING_KEY', async () => {
    stubAnchor(
      buildCustomChallenge({
        sourceAccountId: server.publicKey(),
        signer: attacker,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
      })
    );
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/not signed by the anchor's SIGNING_KEY/);
  });

  it('rejects an unsigned challenge', async () => {
    stubAnchor(
      buildCustomChallenge({
        sourceAccountId: server.publicKey(),
        signer: null,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
      })
    );
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/not signed by the anchor's SIGNING_KEY/);
  });

  it('rejects a challenge carrying a payment after the auth operations', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
        appendOps: [drainPayment(client.publicKey(), attacker.publicKey())],
      })
    );
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/operations other than manage_data/);
  });

  it('rejects a payment presented as the first operation of the "login"', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
        prependOps: [drainPayment(client.publicKey(), attacker.publicKey())],
      })
    );
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/operations other than manage_data/);
  });

  it('rejects an extra manage_data op sourced from the client account', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
        appendOps: [
          Operation.manageData({ name: 'extra', value: 'x', source: client.publicKey() }),
        ],
      })
    );
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/not sourced from the anchor's SIGNING_KEY/);
  });

  it('rejects a challenge for the wrong home domain', async () => {
    stubAnchor(valid({ homeDomain: 'evil.example.org' }));
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/does not name this anchor's domain/);
  });

  it('rejects a web_auth_domain that is not the WEB_AUTH_ENDPOINT host', async () => {
    stubAnchor(valid({ webAuthDomain: 'evil.example.org' }));
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/web_auth_domain "evil.example.org" does not match/);
  });

  it('rejects a challenge for a different client account', async () => {
    stubAnchor(
      buildValidChallenge({
        server,
        clientAccountId: attacker.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
      })
    );
    const err = await expectRefused(anchor());
    expect(err.reason).toBe('WRONG_ACCOUNT');
  });

  it('rejects expired timebounds', async () => {
    // Issue the challenge an hour ago with the standard 5-minute window.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 60 * 60 * 1000);
    const stale = valid();
    vi.useRealTimers();

    stubAnchor(stale);
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/expired/);
  });

  it('rejects a challenge with infinite timebounds', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
        timeoutSeconds: 0,
      })
    );
    await expectRefused(anchor());
  });

  it('rejects a hash memo', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
        memo: Memo.hash('a'.repeat(64)),
      })
    );
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/hash memo/);
  });

  it('accepts the 24-hour window cowrie and zeam issue on mainnet', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
        timeoutSeconds: 24 * 60 * 60,
      })
    );
    const f = await freighter();

    const auth = await authenticate(anchor(), client.publicKey());

    expect(auth.anchorDomain).toBe(HOME_DOMAIN);
    expect(f.signTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a timebounds window longer than 24 hours', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: HOME_DOMAIN,
        webAuthDomain: WEB_AUTH_DOMAIN,
        timeoutSeconds: 7 * 24 * 60 * 60,
      })
    );
    const err = await expectRefused(anchor());
    expect(err.detail).toMatch(/longer than 24 hours/);
  });

  it('rejects a toml with no SIGNING_KEY before fetching anything', async () => {
    const fetchMock = stubAnchor(valid());
    const err = await expectRefused(anchor({ SIGNING_KEY: null }));
    expect(err.reason).toBe('MISSING_SIGNING_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a SIGNING_KEY that is not a Stellar public key', async () => {
    stubAnchor(valid());
    const err = await expectRefused(anchor({ SIGNING_KEY: 'G...' }));
    expect(err.reason).toBe('MISSING_SIGNING_KEY');
  });

  it('rejects an http WEB_AUTH_ENDPOINT before fetching anything', async () => {
    const fetchMock = stubAnchor(valid());
    const err = await expectRefused(
      anchor({ WEB_AUTH_ENDPOINT: 'http://auth.anchor.example.com/sep10' })
    );
    expect(err.reason).toBe('INSECURE_ENDPOINT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unparseable challenge XDR', async () => {
    stubAnchor('not-a-transaction');
    const err = await expectRefused(anchor());
    expect(err.reason).toBe('INVALID_CHALLENGE');
  });

  it('keeps rejecting a non-mainnet challenge as WRONG_NETWORK', async () => {
    stubAnchor(valid(), Networks.TESTNET);
    await expect(
      fetchSep10Challenge(WEB_AUTH_ENDPOINT, client.publicKey(), HOME_DOMAIN, server.publicKey())
    ).rejects.toMatchObject({ name: 'ChallengeError', code: 'WRONG_NETWORK' });
  });
});

/**
 * Regression shapes decoded from live mainnet anchors (2026-09-23). Each
 * deviates from SEP-10 in a way that cannot move funds, and each must pass.
 * Keys are random; op names, memos and domains match what the anchor sent.
 */
describe('SEP-10 challenge validation — tolerated real-world shapes', () => {
  it('cowrie.exchange: web_auth_domain carries the home domain, not the endpoint host', async () => {
    const endpoint = 'https://api.cowrie.exchange/web_auth';
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: 'cowrie.exchange',
        webAuthDomain: 'cowrie.exchange',
      })
    );
    const auth = await authenticate(
      anchor({
        homeDomain: 'cowrie.exchange',
        domain: 'cowrie.exchange',
        WEB_AUTH_ENDPOINT: endpoint,
      }),
      client.publicKey()
    );
    expect(auth.anchorDomain).toBe('cowrie.exchange');
  });

  it('anclap.com: auth key and web_auth_domain name the endpoint host', async () => {
    const endpoint = 'https://api.anclap.com/auth';
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: 'api.anclap.com',
        webAuthDomain: 'api.anclap.com',
      })
    );
    const auth = await authenticate(
      anchor({ homeDomain: 'anclap.com', domain: 'anclap.com', WEB_AUTH_ENDPOINT: endpoint }),
      client.publicKey()
    );
    expect(auth.anchorDomain).toBe('anclap.com');
  });

  it('zeam.money: text memo and no web_auth_domain op', async () => {
    const endpoint = 'https://anchor.zeam.money/auth';
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: 'zeam.money',
        webAuthDomain: null,
        memo: Memo.text('zeam.money'),
      })
    );
    const auth = await authenticate(
      anchor({ homeDomain: 'zeam.money', domain: 'zeam.money', WEB_AUTH_ENDPOINT: endpoint }),
      client.publicKey()
    );
    expect(auth.anchorDomain).toBe('zeam.money');
  });

  it('still refuses a payment smuggled into an otherwise tolerated shape', async () => {
    stubAnchor(
      buildCustomChallenge({
        signer: server,
        clientAccountId: client.publicKey(),
        homeDomain: 'zeam.money',
        webAuthDomain: null,
        memo: Memo.text('zeam.money'),
        appendOps: [drainPayment(client.publicKey(), attacker.publicKey())],
      })
    );
    const err = await expectRefused(
      anchor({
        homeDomain: 'zeam.money',
        domain: 'zeam.money',
        WEB_AUTH_ENDPOINT: 'https://anchor.zeam.money/auth',
      })
    );
    expect(err.detail).toMatch(/operations other than manage_data/);
  });
});

describe('SEP-10 challenge validation — signer gate', () => {
  it('refuses to sign an object the validator did not produce', async () => {
    const forged = {
      transaction: valid(),
      network_passphrase: Networks.PUBLIC,
    } as unknown as Sep10Challenge;
    const f = await freighter();

    await expect(signChallenge(forged)).rejects.toBeInstanceOf(ChallengeError);
    expect(f.signTransaction).not.toHaveBeenCalled();
  });
});

describe('SEP-10 challenge validation — UI surface', () => {
  it('shows the rejection verbatim and marks it non-retryable', () => {
    const err = new Sep10ChallengeRejectedError(
      HOME_DOMAIN,
      'INVALID_CHALLENGE',
      'The transaction has expired'
    );
    expect(classifyExecuteError(err)).toBe(err.message);
    expect(err.message).toContain(HOME_DOMAIN);
    expect(err.message).toMatch(/Nothing was sent to your wallet/);
    expect(isRetryableExecuteError(err)).toBe(false);
  });
});
