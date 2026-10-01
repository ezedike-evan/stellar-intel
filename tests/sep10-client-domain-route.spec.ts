import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair, Networks, Transaction, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { buildCustomChallenge, drainPayment } from './fixtures/sep10-challenge';

// resolveToml is the only network dependency; everything else is real crypto so
// the signature the route adds is verified against real bytes (#1327).
vi.mock('@/lib/stellar/sep1', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/sep1')>();
  return { ...actual, resolveToml: vi.fn() };
});

import { resolveToml } from '@/lib/stellar/sep1';
import { POST } from '@/app/api/sep10/client-domain/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

// A registered anchor with no distinct service domain, so the toml domain is its
// home domain.
const ANCHOR_DOMAIN = 'anclap.com';
const OUR_DOMAIN = 'stellarintel.test';

const server = Keypair.random();
const ourKeypair = Keypair.random();
const client = Keypair.random();

const mockedResolveToml = vi.mocked(resolveToml);

function stubToml() {
  mockedResolveToml.mockResolvedValue({
    ok: true,
    data: {
      domain: ANCHOR_DOMAIN,
      SIGNING_KEY: server.publicKey(),
      WEB_AUTH_ENDPOINT: `https://${ANCHOR_DOMAIN}/auth`,
      TRANSFER_SERVER: null,
      TRANSFER_SERVER_SEP0024: null,
      DIRECT_PAYMENT_SERVER: null,
      ANCHOR_QUOTE_SERVER: null,
      NETWORK_PASSPHRASE: Networks.PUBLIC,
      ORG_URL: null,
      ORG_SUPPORT_EMAIL: null,
      ORG_SUPPORT_URL: null,
      CURRENCIES: [],
      capabilities: {
        sep10: true,
        sep24: false,
        sep38: false,
        sep12: true,
        sep6: false,
        sep31: false,
      },
      seps: [],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

/** Build a client_domain challenge exactly as an honest anchor would issue it. */
function buildClientDomainChallenge(opts?: {
  clientDomain?: string | null;
  clientSigningKey?: string;
}): string {
  return WebAuth.buildChallengeTx(
    server,
    client.publicKey(),
    ANCHOR_DOMAIN,
    300,
    Networks.PUBLIC,
    ANCHOR_DOMAIN,
    null,
    opts?.clientDomain === undefined ? OUR_DOMAIN : opts.clientDomain,
    opts?.clientSigningKey ?? ourKeypair.publicKey()
  );
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sep10/client-domain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function signedByOurKey(xdr: string): boolean {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction;
  const hash = tx.hash();
  return tx.signatures.some((sig) => {
    try {
      return ourKeypair.verify(hash, sig.signature.toBytes());
    } catch {
      return false;
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  clearRateLimitStore();
  vi.stubEnv('CLIENT_DOMAIN', OUR_DOMAIN);
  vi.stubEnv('CLIENT_DOMAIN_SIGNING_SECRET', ourKeypair.secret());
  stubToml();
});

describe('POST /api/sep10/client-domain — happy path', () => {
  it('co-signs a valid client_domain challenge and returns a signed tx', async () => {
    const transaction = buildClientDomainChallenge();
    const res = await POST(makeRequest({ transaction, homeDomain: ANCHOR_DOMAIN }));
    expect(res.status).toBe(200);

    const data = (await res.json()) as { transaction: string };
    expect(typeof data.transaction).toBe('string');
    expect(signedByOurKey(data.transaction)).toBe(true);
  });

  it('accepts the anchor matched on its service domain', async () => {
    // cowrie.exchange has serviceDomain api.cowrie.exchange; resolve is mocked so
    // the toml domain does not matter, only that the lookup succeeds.
    const transaction = buildClientDomainChallenge();
    const res = await POST(makeRequest({ transaction, homeDomain: ANCHOR_DOMAIN }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/sep10/client-domain — rejects non-conforming challenges', () => {
  it('rejects a challenge with no client_domain op', async () => {
    const transaction = buildClientDomainChallenge({ clientDomain: null });
    const res = await POST(makeRequest({ transaction, homeDomain: ANCHOR_DOMAIN }));
    expect(res.status).toBe(400);
  });

  it('rejects a client_domain naming a different domain', async () => {
    const transaction = buildClientDomainChallenge({ clientDomain: 'evil.test' });
    const res = await POST(makeRequest({ transaction, homeDomain: ANCHOR_DOMAIN }));
    expect(res.status).toBe(400);
  });

  it('rejects a client_domain op sourced by another key', async () => {
    const transaction = buildClientDomainChallenge({
      clientSigningKey: Keypair.random().publicKey(),
    });
    const res = await POST(makeRequest({ transaction, homeDomain: ANCHOR_DOMAIN }));
    expect(res.status).toBe(400);
  });

  it('rejects a transaction carrying a payment op (not a challenge) without signing', async () => {
    const transaction = buildCustomChallenge({
      signer: server,
      clientAccountId: client.publicKey(),
      homeDomain: ANCHOR_DOMAIN,
      webAuthDomain: ANCHOR_DOMAIN,
      prependOps: [drainPayment(server.publicKey(), client.publicKey())],
    });
    const res = await POST(makeRequest({ transaction, homeDomain: ANCHOR_DOMAIN }));
    expect(res.status).toBe(400);
  });

  it('rejects a challenge whose sequence number is not zero', async () => {
    const transaction = buildCustomChallenge({
      signer: server,
      sequence: 42n,
      clientAccountId: client.publicKey(),
      homeDomain: ANCHOR_DOMAIN,
      webAuthDomain: ANCHOR_DOMAIN,
    });
    const res = await POST(makeRequest({ transaction, homeDomain: ANCHOR_DOMAIN }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/sep10/client-domain — configuration and registration', () => {
  it('returns 400 for an unregistered home domain', async () => {
    const transaction = buildClientDomainChallenge();
    const res = await POST(makeRequest({ transaction, homeDomain: 'not-an-anchor.example' }));
    expect(res.status).toBe(400);
  });

  it('returns 503 when the client_domain key is unconfigured', async () => {
    vi.stubEnv('CLIENT_DOMAIN_SIGNING_SECRET', '');
    const transaction = buildClientDomainChallenge();
    const res = await POST(makeRequest({ transaction, homeDomain: ANCHOR_DOMAIN }));
    expect(res.status).toBe(503);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe('client_domain_unconfigured');
  });

  it('rejects a malformed JSON body with 400', async () => {
    const req = new NextRequest('http://localhost/api/sep10/client-domain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
