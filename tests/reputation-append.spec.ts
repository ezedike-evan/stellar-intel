import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { POST as appendPOST } from '@/app/api/reputation/append/route';
import { GET as reconcileGET } from '@/app/api/reputation/reconcile/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import {
  InMemoryReputationStore,
  _setReputationStore,
  type ReputationStore,
} from '@/lib/reputation/store';
import { SqliteReputationStore } from '@/lib/reputation/sqlite';

let store: ReputationStore;

beforeEach(() => {
  clearRateLimitStore();
  store = new InMemoryReputationStore();
  _setReputationStore(store);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await store.close();
  _setReputationStore(null);
});

const HASH = 'a'.repeat(64);
const STELLAR_TX = 'b'.repeat(64);
const sender = Keypair.random();

function outcome(extra: Record<string, unknown> = {}) {
  return {
    intentHash: HASH,
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    quotedRate: '1500.0',
    quotedAmount: '100',
    outcome: 'completed' as const,
    stellarTransactionId: STELLAR_TX,
    ...extra,
  };
}

/** Raw Ed25519 signature over the hash bytes — the envelope the dispute proof uses. */
function signRaw(hash: string, kp: Keypair): string {
  return Buffer.from(kp.sign(Buffer.from(hash, 'hex'))).toString('base64');
}

/** SEP-53 signature over the hex string — what Freighter's signMessage produces. */
function signSep53(hash: string, kp: Keypair): string {
  return Buffer.from(kp.signMessage(hash)).toString('base64');
}

function signed(extra: Record<string, unknown> = {}, kp: Keypair = sender) {
  const body = outcome(extra);
  return { ...body, publicKey: kp.publicKey(), signature: signRaw(body.intentHash, kp) };
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reputation/append', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/reputation/append — attestation', () => {
  it('stores a validly signed row as attested with its signer', async () => {
    const res = await appendPOST(req(signed()));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, intentHash: HASH, attested: true });

    const rows = await store.query({});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attested).toBe(true);
    expect(rows[0]?.signerAccount).toBe(sender.publicKey());
  });

  it('accepts a SEP-53 (Freighter signMessage) signature', async () => {
    const body = {
      ...outcome(),
      publicKey: sender.publicKey(),
      signature: signSep53(HASH, sender),
    };
    const res = await appendPOST(req(body));
    expect(res.status).toBe(201);
  });

  it('rejects an unsigned row with 401 and writes nothing', async () => {
    const res = await appendPOST(req(outcome()));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHORIZED');
    expect(await store.query({ includeUnattested: true })).toHaveLength(0);
  });

  it('rejects a signature without its publicKey (and vice versa) with 401', async () => {
    const { publicKey, signature } = signed();
    expect((await appendPOST(req({ ...outcome(), signature }))).status).toBe(401);
    expect((await appendPOST(req({ ...outcome(), publicKey }))).status).toBe(401);
  });

  it('rejects a signature by a different key than the claimed account with 401', async () => {
    const forger = Keypair.random();
    const body = { ...outcome(), publicKey: sender.publicKey(), signature: signRaw(HASH, forger) };
    const res = await appendPOST(req(body));
    expect(res.status).toBe(401);
    expect(await store.query({ includeUnattested: true })).toHaveLength(0);
  });

  it('rejects a signature over a different intent hash with 401', async () => {
    const body = {
      ...outcome(),
      publicKey: sender.publicKey(),
      signature: signRaw('c'.repeat(64), sender),
    };
    expect((await appendPOST(req(body))).status).toBe(401);
  });
});

describe('POST /api/reputation/append — validation', () => {
  it.each([
    ['an unknown anchor', { anchorId: 'not-an-anchor' }],
    ['a corridor the anchor does not serve', { corridor: 'usdc-kes' }],
    ['an unregistered corridor', { corridor: 'usdc-xyz' }],
    ['an unknown outcome', { outcome: 'nope' }],
    ['a non-hex intent hash', { intentHash: 'intent-1' }],
    ['a short intent hash', { intentHash: 'a'.repeat(63) }],
    ['a negative amount', { quotedAmount: '-5' }],
    ['an absurd amount', { quotedAmount: '1' + '0'.repeat(20) }],
    ['an absurd rate', { quotedRate: '99999999999' }],
    ['a negative settle time', { settleSeconds: -1 }],
    ['a settle time beyond 90 days', { settleSeconds: 90 * 86_400 + 1 }],
    ['a malformed Stellar tx hash', { stellarTransactionId: 'stellar-tx-1' }],
  ])('rejects %s with 400 and writes nothing', async (_label, extra) => {
    const res = await appendPOST(req(signed(extra)));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(await store.query({ includeUnattested: true })).toHaveLength(0);
  });

  it('ignores client-supplied server-managed fields', async () => {
    const res = await appendPOST(
      req(
        signed({
          createdAt: '2000-01-01T00:00:00.000Z',
          publishedAt: '2026-01-01T00:00:00.000Z',
          oracleTxHash: 'd'.repeat(64),
          reconciledAt: '2026-01-01T00:00:00.000Z',
          disputed: true,
          attested: false,
        })
      )
    );
    expect(res.status).toBe(201);
    const [row] = await store.query({});
    expect(row?.createdAt.startsWith('2000')).toBe(false);
    expect(row?.publishedAt).toBeNull();
    expect(row?.oracleTxHash).toBeNull();
    expect(row?.reconciledAt).toBeNull();
    expect(row?.disputed).toBe(false);
    expect(row?.attested).toBe(true);
  });
});

describe.each([
  ['memory', () => new InMemoryReputationStore()],
  ['sqlite', () => new SqliteReputationStore(':memory:')],
])('POST /api/reputation/append — duplicates (%s store)', (_name, make) => {
  beforeEach(async () => {
    await store.close();
    store = make();
    _setReputationStore(store);
  });

  it('answers a repeat POST with 409 and keeps the first row', async () => {
    expect((await appendPOST(req(signed()))).status).toBe(201);

    const retry = await appendPOST(req(signed()));
    expect(retry.status).toBe(409);
    expect((await retry.json()).code).toBe('CONFLICT');

    const rewrite = await appendPOST(req(signed({ outcome: 'error', quotedAmount: '1' })));
    expect(rewrite.status).toBe(409);

    const rows = await store.query({});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('completed');
    expect(rows[0]?.quotedAmount).toBe('100');
  });

  it('a second signer cannot take over an existing row', async () => {
    await appendPOST(req(signed()));
    const other = Keypair.random();
    expect((await appendPOST(req(signed({ outcome: 'error' }, other)))).status).toBe(409);
    const [row] = await store.query({});
    expect(row?.signerAccount).toBe(sender.publicKey());
  });
});

describe('append -> reconcile end-to-end (#220 + #221 + #219)', () => {
  it('backfills the delivered amount from Horizon within the store', async () => {
    await appendPOST(req(signed()));
    expect((await store.query({}))[0]?.deliveredAmount).toBeNull();

    // Stub Horizon: the settlement payment for the outcome's Stellar tx.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ _embedded: { records: [{ type: 'payment', amount: '149000' }] } }),
      }))
    );

    const res = await reconcileGET(
      new NextRequest('http://localhost/api/reputation/reconcile', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    );
    const summary = await res.json();
    expect(summary.updated).toBe(1);

    const [row] = await store.query({ anchorId: 'cowrie' });
    expect(row?.deliveredAmount).toBe('149000');
    expect(row?.deliveredRate).toBe('1490.00000000'); // 149000 / 100
    expect(row?.reconciledAt).not.toBeNull();
    expect(await store.query({ pendingReconciliationOnly: true })).toHaveLength(0);
  });
});
