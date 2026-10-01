import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, Networks, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { authenticate, invalidateSep10Token, Sep10AuthError } from '@/lib/stellar/sep10';
import type { ResolvedAnchor } from '@/types';
import {
  buildValidChallenge,
  buildValidChallengeWithClientDomain,
} from './fixtures/sep10-challenge';

const HOME_DOMAIN = 'client-domain.example';
const WEB_AUTH_ENDPOINT = `https://${HOME_DOMAIN}/auth`;
const SERVER = Keypair.random();
const WALLET = Keypair.random();
const CLIENT_DOMAIN_SIGNER = Keypair.random();
const JWT = `${btoa('{"alg":"HS256"}')}.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
  getNetwork: vi.fn(async () => ({
    error: false,
    network: '',
    networkPassphrase: Networks.PUBLIC,
  })),
}));

function anchor(sep10ClientDomain: boolean): ResolvedAnchor {
  return {
    id: HOME_DOMAIN,
    name: 'Client Domain Anchor',
    homeDomain: HOME_DOMAIN,
    corridors: [],
    assetCode: 'USDC',
    assetIssuer: 'G...',
    sep10ClientDomain,
    WEB_AUTH_ENDPOINT,
    SIGNING_KEY: SERVER.publicKey(),
    capabilities: { sep10: true, sep24: false, sep38: false, sep12: false },
    domain: HOME_DOMAIN,
    TRANSFER_SERVER_SEP0024: null,
    ANCHOR_QUOTE_SERVER: null,
    NETWORK_PASSPHRASE: null,
    ORG_URL: null,
    ORG_SUPPORT_EMAIL: null,
    ORG_SUPPORT_URL: null,
    CURRENCIES: [],
  };
}

function challengeXdr(): string {
  return buildValidChallenge({
    server: SERVER,
    clientAccountId: WALLET.publicKey(),
    homeDomain: HOME_DOMAIN,
    webAuthDomain: HOME_DOMAIN,
  });
}

function challengeXdrWithClientDomain(clientDomain: string): string {
  return buildValidChallengeWithClientDomain({
    server: SERVER,
    clientAccountId: WALLET.publicKey(),
    homeDomain: HOME_DOMAIN,
    webAuthDomain: HOME_DOMAIN,
    clientDomain,
  });
}

function response(body: Record<string, string>, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  invalidateSep10Token(HOME_DOMAIN, WALLET.publicKey());
});

describe('SEP-10 client-domain authentication', () => {
  it('co-signs flagged anchors before submitting the wallet-signed transaction', async () => {
    const CLIENT_DOMAIN = 'wallet.example';
    vi.stubEnv('NEXT_PUBLIC_SEP10_CLIENT_DOMAIN', CLIENT_DOMAIN);
    const originalChallenge = challengeXdrWithClientDomain(CLIENT_DOMAIN);
    const coSigned = TransactionBuilder.fromXDR(originalChallenge, Networks.PUBLIC) as Transaction;
    coSigned.sign(CLIENT_DOMAIN_SIGNER);
    const coSignedXdr = coSigned.toXDR();
    const { signTransaction } = await import('@stellar/freighter-api');
    vi.mocked(signTransaction).mockImplementation(async (xdr) => {
      const transaction = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction;
      expect(transaction.signatures).toHaveLength(2);
      transaction.sign(WALLET);
      return { signedTxXdr: transaction.toXDR(), signerAddress: WALLET.publicKey() };
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ transaction: originalChallenge, network_passphrase: Networks.PUBLIC })
      )
      .mockResolvedValueOnce(response({ transaction: coSignedXdr }))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const submitted = JSON.parse(init.body as string) as { transaction: string };
        const transaction = TransactionBuilder.fromXDR(
          submitted.transaction,
          Networks.PUBLIC
        ) as Transaction;
        expect(transaction.signatures).toHaveLength(3);
        return response({ token: JWT });
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(authenticate(anchor(true), WALLET.publicKey())).resolves.toMatchObject({
      jwt: JWT,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`client_domain=${CLIENT_DOMAIN}`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/sep10/client-domain');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      transaction: originalChallenge,
      homeDomain: HOME_DOMAIN,
    });
  });

  it('rejects a co-sign response that changes the challenge before calling Freighter', async () => {
    const CLIENT_DOMAIN = 'wallet.example';
    vi.stubEnv('NEXT_PUBLIC_SEP10_CLIENT_DOMAIN', CLIENT_DOMAIN);
    const { signTransaction } = await import('@stellar/freighter-api');
    const originalChallenge = challengeXdrWithClientDomain(CLIENT_DOMAIN);
    // Return a *different* challenge on co-sign to simulate tampering.
    const differentChallenge = challengeXdrWithClientDomain(CLIENT_DOMAIN);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ transaction: originalChallenge, network_passphrase: Networks.PUBLIC })
      )
      .mockResolvedValueOnce(response({ transaction: differentChallenge }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(authenticate(anchor(true), WALLET.publicKey())).rejects.toThrow(
      'Client-domain co-sign response changed the SEP-10 challenge'
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('does not call the co-sign route for unflagged anchors', async () => {
    const { signTransaction } = await import('@stellar/freighter-api');
    vi.mocked(signTransaction).mockResolvedValue({
      signedTxXdr: challengeXdr(),
      signerAddress: WALLET.publicKey(),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ transaction: challengeXdr(), network_passphrase: Networks.PUBLIC })
      )
      .mockResolvedValueOnce(response({ token: JWT }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticate(anchor(false), WALLET.publicKey());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/sep10/client-domain')).toBe(false);
  });

  it('fails clearly when a flagged anchor has no configured client domain', async () => {
    await expect(authenticate(anchor(true), WALLET.publicKey())).rejects.toEqual(
      expect.objectContaining({
        name: 'Sep10AuthError',
        message:
          'This anchor requires SEP-10 client_domain, which is not configured on this deployment.',
      })
    );
    await expect(authenticate(anchor(true), WALLET.publicKey())).rejects.toBeInstanceOf(
      Sep10AuthError
    );
  });
});
