import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import type { OutcomeIntent } from '@/lib/reputation/schema';
import { POST as appendPOST } from '@/app/api/reputation/append/route';
import { GET as reconcileGET } from '@/app/api/reputation/reconcile/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import {
  InMemoryReputationStore,
  _setReputationStore,
  type ReputationStore,
} from '@/lib/reputation/store';
import { SqliteReputationStore } from '@/lib/reputation/sqlite';
import { _setWebhookEmitter } from '@/lib/webhooks/emit';
import {
  InMemorySlippageBreachStore,
  _setSlippageBreachStore,
  getSlippageBreachStore,
  type SlippageBreachStore,
} from '@/lib/reputation/slippage-breaches';
import { hashIntent } from '@/lib/intent/hash';
import {
  _setRefundStore,
  getRefundStore,
  InMemoryRefundStore,
  type RefundStore,
} from '@/lib/refunds/store';

let store: ReputationStore;
let emitted: Array<{ kind: string; payload: Record<string, unknown> }>;

beforeEach(() => {
  clearRateLimitStore();
  store = new InMemoryReputationStore();
  _setReputationStore(store);
  _setSlippageBreachStore(new InMemorySlippageBreachStore());
  _setRefundStore(new InMemoryRefundStore());
  emitted = [];
  _setWebhookEmitter((kind, payload) => emitted.push({ kind, payload }));
});

afterEach(async () => {
  _setWebhookEmitter(null);
  _setSlippageBreachStore(null);
  _setRefundStore(null);
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
    corridor: 'ngnt-ngn',
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

describe('POST /api/reputation/append — direction (ONR031)', () => {
  it('defaults an omitted direction to withdraw', async () => {
    const res = await appendPOST(req(signed()));
    expect(res.status).toBe(201);
    const [row] = await store.query({ includeUnattested: true });
    expect(row?.direction).toBe('withdraw');
  });

  it('accepts and stores direction: deposit', async () => {
    const res = await appendPOST(req(signed({ direction: 'deposit' })));
    expect(res.status).toBe(201);
    const [row] = await store.query({ includeUnattested: true });
    expect(row?.direction).toBe('deposit');
    expect(await store.query({ direction: 'withdraw', includeUnattested: true })).toHaveLength(0);
  });

  it('rejects an unknown direction', async () => {
    const res = await appendPOST(req(signed({ direction: 'sideways' })));
    expect(res.status).toBe(400);
  });
});

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

  it('emits no webhook for a 409 duplicate', async () => {
    expect((await appendPOST(req(signed()))).status).toBe(201);
    emitted = [];

    expect((await appendPOST(req(signed()))).status).toBe(409);
    expect((await appendPOST(req(signed({ outcome: 'error' })))).status).toBe(409);
    expect(emitted).toEqual([]);
  });

  it('a second signer cannot take over an existing row', async () => {
    await appendPOST(req(signed()));
    const other = Keypair.random();
    expect((await appendPOST(req(signed({ outcome: 'error' }, other)))).status).toBe(409);
    const [row] = await store.query({});
    expect(row?.signerAccount).toBe(sender.publicKey());
  });
});

describe('POST /api/reputation/append — webhooks (#1341)', () => {
  it('emits reputation.event_written then intent.settled for a completed row', async () => {
    expect((await appendPOST(req(signed()))).status).toBe(201);
    const [row] = await store.query({});

    expect(emitted).toEqual([
      {
        kind: 'reputation.event_written',
        payload: {
          intentHash: HASH,
          anchorId: 'cowrie',
          corridor: 'ngnt-ngn',
          outcome: 'completed',
          createdAt: row?.createdAt,
        },
      },
      {
        kind: 'intent.settled',
        payload: {
          intentHash: HASH,
          anchorId: 'cowrie',
          corridor: 'ngnt-ngn',
          quotedAmount: '100',
          stellarTransactionId: STELLAR_TX,
        },
      },
    ]);
  });

  it('keys the events of a completed outcome on the intent hash (WHK005)', async () => {
    const keys: Array<{ kind: string; opts: unknown }> = [];
    _setWebhookEmitter((kind, _payload, opts) => keys.push({ kind, opts }));

    expect((await appendPOST(req(signed()))).status).toBe(201);

    expect(keys).toEqual([
      {
        kind: 'reputation.event_written',
        opts: { idempotencyKey: `reputation.event_written:${HASH}` },
      },
      { kind: 'intent.settled', opts: { idempotencyKey: `intent.settled:${HASH}` } },
    ]);
  });

  it('keys the events of a refunded outcome on the intent hash (WHK005)', async () => {
    const keys: Array<{ kind: string; opts: unknown }> = [];
    _setWebhookEmitter((kind, _payload, opts) => keys.push({ kind, opts }));

    expect((await appendPOST(req(signed({ outcome: 'refunded' })))).status).toBe(201);

    expect(keys).toEqual([
      {
        kind: 'reputation.event_written',
        opts: { idempotencyKey: `reputation.event_written:${HASH}` },
      },
      { kind: 'intent.failed', opts: { idempotencyKey: `intent.failed:${HASH}` } },
      // A refunded outcome opens a refund case (#2124), keyed on the new case's id.
      {
        kind: 'refund.opened',
        opts: { idempotencyKey: expect.stringMatching(/^refund\.opened:[0-9a-f-]{36}$/) },
      },
    ]);
  });

  it('gives two outcomes different keys, and the kinds of one outcome different keys', async () => {
    const keys: string[] = [];
    _setWebhookEmitter((_kind, _payload, opts) => keys.push(opts?.idempotencyKey ?? '(none)'));
    const other = 'c'.repeat(64);

    expect((await appendPOST(req(signed()))).status).toBe(201);
    expect((await appendPOST(req(signed({ intentHash: other })))).status).toBe(201);

    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(keys).not.toContain('(none)');
  });

  it('keeps stellarTransactionId as null on intent.settled when it was not sent', async () => {
    expect((await appendPOST(req(signed({ stellarTransactionId: undefined })))).status).toBe(201);

    const settled = emitted.find((e) => e.kind === 'intent.settled');
    expect(settled?.payload).toHaveProperty('stellarTransactionId', null);
  });

  it.each(['error', 'expired', 'refunded'] as const)(
    'emits event_written then intent.failed for an %s row',
    async (outcome) => {
      expect((await appendPOST(req(signed({ outcome })))).status).toBe(201);

      // Each of these, sent with a Stellar transaction id, also opens a refund case (#2124).
      expect(emitted.map((e) => e.kind)).toEqual([
        'reputation.event_written',
        'intent.failed',
        'refund.opened',
      ]);
      expect(emitted[1]?.payload).toEqual({
        intentHash: HASH,
        anchorId: 'cowrie',
        corridor: 'ngnt-ngn',
        outcome,
      });
    }
  );

  it('emits only event_written for a partial row', async () => {
    expect((await appendPOST(req(signed({ outcome: 'partial' })))).status).toBe(201);

    expect(emitted.map((e) => e.kind)).toEqual(['reputation.event_written']);
  });

  it('never puts signerAccount or signature in a payload', async () => {
    await appendPOST(req(signed()));
    await appendPOST(req(signed({ intentHash: 'c'.repeat(64), outcome: 'error' })));

    expect(emitted.length).toBeGreaterThan(0);
    for (const { payload } of emitted) {
      expect(payload).not.toHaveProperty('signerAccount');
      expect(payload).not.toHaveProperty('signature');
      expect(payload).not.toHaveProperty('publicKey');
    }
  });

  it('emits nothing for an unsigned request (401)', async () => {
    expect((await appendPOST(req(outcome()))).status).toBe(401);
    expect(emitted).toEqual([]);
  });

  it('emits nothing for a bad signature (401)', async () => {
    const body = {
      ...outcome(),
      publicKey: sender.publicKey(),
      signature: signRaw(HASH, Keypair.random()),
    };
    expect((await appendPOST(req(body))).status).toBe(401);
    expect(emitted).toEqual([]);
  });

  it('emits nothing for an invalid body (400)', async () => {
    expect((await appendPOST(req(signed({ anchorId: 'not-an-anchor' })))).status).toBe(400);
    expect(emitted).toEqual([]);
  });
});

describe('POST /api/reputation/append — intent.slippage_breach (SLP014)', () => {
  /** A signed completed outcome for an intent that asked for at least 1400, delivering `deliveredAmount`. */
  async function withMinReceive(transactionId: string, deliveredAmount: string) {
    const outcomeIntent = {
      type: 'offramp-outcome' as const,
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      sender: sender.publicKey(),
      recipient: 'user@example.com',
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      transactionId,
      minReceive: '1400',
    };
    const intentHash = await hashIntent(outcomeIntent);
    const body = {
      intentHash,
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      direction: 'withdraw',
      quotedRate: '1500.0',
      quotedAmount: '100',
      deliveredAmount,
      outcome: 'completed',
      minReceive: '1400',
      outcomeIntent,
      publicKey: sender.publicKey(),
      signature: signRaw(intentHash, sender),
    };
    return { intentHash, body };
  }

  it("emits it after the outcome's own events, with exactly the listed keys", async () => {
    const { intentHash, body } = await withMinReceive('anchor-tx-200', '1350');
    expect((await appendPOST(req(body))).status).toBe(201);
    const breach = await getSlippageBreachStore().get(intentHash);

    expect(emitted.map((e) => e.kind)).toEqual([
      'reputation.event_written',
      'intent.settled',
      'intent.slippage_breach',
      // The breach opens a refund case (RFD014), announced last (#2124).
      'refund.opened',
    ]);
    expect(emitted[2]?.payload).toEqual({
      intentHash,
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      minReceive: '1400',
      amountOut: '1350',
      shortfall: '50',
      shortfallBps: 357,
      evidenceHash: breach?.evidenceHash,
      status: 'detected',
      detectedAt: breach?.detectedAt,
    });
    expect(breach?.evidenceHash).toEqual(expect.any(String));
    expect(breach?.detectedAt).toEqual(expect.any(String));
  });

  it('leaves the signer, the evidence and the anchor transaction id out of the payload', async () => {
    const { intentHash, body } = await withMinReceive('anchor-tx-201', '1350');
    expect((await appendPOST(req(body))).status).toBe(201);
    const breach = await getSlippageBreachStore().get(intentHash);
    const payload = emitted.find((e) => e.kind === 'intent.slippage_breach')?.payload ?? {};

    // The record holds all three; the event carries none of them.
    expect(breach?.signerAccount).toBe(sender.publicKey());
    expect(breach?.anchorTransactionId).toBe('anchor-tx-201');
    expect(payload).not.toHaveProperty('signerAccount');
    expect(payload).not.toHaveProperty('evidence');
    expect(payload).not.toHaveProperty('anchorTransactionId');
    const sent = JSON.stringify(payload);
    expect(sent).not.toContain(sender.publicKey());
    expect(sent).not.toContain('anchor-tx-201');
    expect(sent).not.toContain('user@example.com');
  });

  it('keys the event on the intent hash, so a retried emission is one event to a subscriber', async () => {
    const seen: Array<{ kind: string; opts: unknown }> = [];
    _setWebhookEmitter((kind, _payload, opts) => seen.push({ kind, opts }));
    const { intentHash, body } = await withMinReceive('anchor-tx-205', '1350');
    expect((await appendPOST(req(body))).status).toBe(201);

    expect(seen.find((e) => e.kind === 'intent.slippage_breach')?.opts).toEqual({
      idempotencyKey: `intent.slippage_breach:${intentHash}`,
    });
  });

  it('emits nothing more when the outcome met its minimum', async () => {
    const { body } = await withMinReceive('anchor-tx-202', '1450');
    const res = await appendPOST(req(body));
    expect(res.status).toBe(201);
    expect((await res.json()).slippage).toBe('met');

    expect(emitted.map((e) => e.kind)).toEqual(['reputation.event_written', 'intent.settled']);
  });

  it('emits nothing more for an outcome with no minimum to compare', async () => {
    const res = await appendPOST(req(signed()));
    expect(res.status).toBe(201);
    expect((await res.json()).slippage).toBe('not_applicable');

    expect(emitted.map((e) => e.kind)).toEqual(['reputation.event_written', 'intent.settled']);
  });

  it('emits nothing more when the breach could not be recorded', async () => {
    _setSlippageBreachStore({
      create: async () => {
        throw new Error('db down');
      },
      get: async () => null,
      list: async () => [],
      resolveVerification: async () => null,
      close: async () => {},
    } as unknown as Parameters<typeof _setSlippageBreachStore>[0]);
    const { body } = await withMinReceive('anchor-tx-203', '1350');
    const res = await appendPOST(req(body));
    expect(res.status).toBe(201);
    expect((await res.json()).slippage).toBe('unrecorded');

    expect(emitted.map((e) => e.kind)).toEqual(['reputation.event_written', 'intent.settled']);
  });

  it('a repeated POST of the same outcome does not announce the breach twice', async () => {
    const { body } = await withMinReceive('anchor-tx-204', '1350');
    expect((await appendPOST(req(body))).status).toBe(201);
    expect((await appendPOST(req(body))).status).toBe(409);

    expect(emitted.filter((e) => e.kind === 'intent.slippage_breach')).toHaveLength(1);
  });
});

describe('append -> reconcile end-to-end (#220 + #221 + #219)', () => {
  it('backfills the delivered amount from Horizon within the store', async () => {
    await appendPOST(req(signed()));
    expect((await store.query({}))[0]?.deliveredAmount).toBeNull();

    // Stub Horizon: the settlement payment for the outcome's Stellar tx. `from`
    // must match the row's signerAccount (#1334) or the reconciler flags
    // source_mismatch instead of backfilling.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          _embedded: {
            records: [{ type: 'payment', amount: '149000', from: sender.publicKey() }],
          },
        }),
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

describe('POST /api/reputation/append — slippage detection (SLP008)', () => {
  it('signed POST (with outcomeIntent) and deliveredAmount below minReceive → 201 slippage: "breach", and getSlippageBreachStore().get(intentHash) is not null', async () => {
    const outcomeIntent = {
      type: 'offramp-outcome' as const,
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      sender: sender.publicKey(),
      recipient: 'user@example.com',
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      transactionId: 'anchor-tx-100',
      minReceive: '1400',
    };
    const intentHash = await hashIntent(outcomeIntent);
    const body = {
      intentHash,
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      direction: 'withdraw',
      quotedRate: '1500.0',
      quotedAmount: '100',
      deliveredAmount: '1350',
      outcome: 'completed',
      minReceive: '1400',
      outcomeIntent,
      publicKey: sender.publicKey(),
      signature: signRaw(intentHash, sender),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.slippage).toBe('breach');

    const breach = await getSlippageBreachStore().get(intentHash);
    expect(breach).not.toBeNull();
    expect(breach?.amountOut).toBe('1350');
    expect(breach?.minReceive).toBe('1400');
    expect(breach?.shortfall).toBe('50');
    expect(breach?.anchorTransactionId).toBe('anchor-tx-100');
  });

  it('above the floor → "met"', async () => {
    const outcomeIntent = {
      type: 'offramp-outcome' as const,
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      sender: sender.publicKey(),
      recipient: 'user@example.com',
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      transactionId: 'anchor-tx-101',
      minReceive: '1400',
    };
    const intentHash = await hashIntent(outcomeIntent);
    const body = {
      intentHash,
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      direction: 'withdraw',
      quotedRate: '1500.0',
      quotedAmount: '100',
      deliveredAmount: '1450',
      outcome: 'completed',
      minReceive: '1400',
      outcomeIntent,
      publicKey: sender.publicKey(),
      signature: signRaw(intentHash, sender),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.slippage).toBe('met');
    expect(await getSlippageBreachStore().get(intentHash)).toBeNull();
  });

  it('a duplicate POST → 409, still one breach', async () => {
    const outcomeIntent = {
      type: 'offramp-outcome' as const,
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      sender: sender.publicKey(),
      recipient: 'user@example.com',
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      transactionId: 'anchor-tx-102',
      minReceive: '1400',
    };
    const intentHash = await hashIntent(outcomeIntent);
    const body = {
      intentHash,
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      direction: 'withdraw',
      quotedRate: '1500.0',
      quotedAmount: '100',
      deliveredAmount: '1350',
      outcome: 'completed',
      minReceive: '1400',
      outcomeIntent,
      publicKey: sender.publicKey(),
      signature: signRaw(intentHash, sender),
    };

    const res1 = await appendPOST(req(body));
    expect(res1.status).toBe(201);
    expect((await res1.json()).slippage).toBe('breach');

    const res2 = await appendPOST(req(body));
    expect(res2.status).toBe(409);

    const list = await getSlippageBreachStore().list();
    expect(list.filter((b) => b.intentHash === intentHash)).toHaveLength(1);
  });

  it('breach store failing → still 201 with "unrecorded"', async () => {
    const failingStore: SlippageBreachStore = {
      create: async () => {
        throw new Error('Store failure');
      },
      get: async () => null,
      list: async () => [],
      resolveVerification: async () => null,
    };
    _setSlippageBreachStore(failingStore);

    const outcomeIntent = {
      type: 'offramp-outcome' as const,
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      sender: sender.publicKey(),
      recipient: 'user@example.com',
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      transactionId: 'anchor-tx-103',
      minReceive: '1400',
    };
    const intentHash = await hashIntent(outcomeIntent);
    const body = {
      intentHash,
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      direction: 'withdraw',
      quotedRate: '1500.0',
      quotedAmount: '100',
      deliveredAmount: '1350',
      outcome: 'completed',
      minReceive: '1400',
      outcomeIntent,
      publicKey: sender.publicKey(),
      signature: signRaw(intentHash, sender),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.slippage).toBe('unrecorded');
  });

  it('a recorded slippage breach also opens an owed refund case (RFD014)', async () => {
    const outcomeIntent = {
      type: 'offramp-outcome' as const,
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      sender: sender.publicKey(),
      recipient: 'user@example.com',
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      transactionId: 'anchor-tx-refund-breach',
      minReceive: '1400',
    };
    const intentHash = await hashIntent(outcomeIntent);
    const body = {
      intentHash,
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      direction: 'withdraw',
      quotedRate: '1500.0',
      quotedAmount: '100',
      deliveredAmount: '1350',
      outcome: 'completed',
      minReceive: '1400',
      outcomeIntent,
      publicKey: sender.publicKey(),
      signature: signRaw(intentHash, sender),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(201);
    expect((await res.json()).slippage).toBe('breach');

    const refundCases = await getRefundStore().getByIntentHash(intentHash);
    expect(refundCases).toHaveLength(1);
    expect(refundCases[0]).toMatchObject({
      reason: 'slippage_breach',
      status: 'owed',
      refundedAt: null,
      amountPaid: '100',
    });
  });
});

describe('POST /api/reputation/append — auto-open refund cases (RFD004)', () => {
  let refundStore: InMemoryRefundStore;

  beforeEach(() => {
    refundStore = new InMemoryRefundStore();
    _setRefundStore(refundStore);
  });

  afterEach(() => {
    _setRefundStore(null);
  });

  it('opens a refunded case for a signed refunded append', async () => {
    expect((await appendPOST(req(signed({ outcome: 'refunded' })))).status).toBe(201);
    const cases = await refundStore.list();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      intentHash: HASH,
      reason: 'anchor_refunded',
      status: 'refunded',
      amountPaid: '100',
    });
    expect(cases[0]?.refundedAt).not.toBeNull();
  });

  it('opens an owed case for a signed withdraw error after payment', async () => {
    expect((await appendPOST(req(signed({ outcome: 'error' })))).status).toBe(201);
    const cases = await refundStore.list();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ reason: 'anchor_error_after_payment', status: 'owed' });
    expect(cases[0]?.refundedAt).toBeNull();
  });

  it('opens nothing for a completed append', async () => {
    expect((await appendPOST(req(signed()))).status).toBe(201);
    expect(await refundStore.list()).toHaveLength(0);
  });

  it('still answers 201 when the refund store throws', async () => {
    const throwing: RefundStore = {
      open: async () => {
        throw new Error('refund store down');
      },
      get: async () => null,
      getByIntentHash: async () => [],
      list: async () => [],
      acknowledge: async () => null,
    };
    _setRefundStore(throwing);
    expect((await appendPOST(req(signed({ outcome: 'refunded' })))).status).toBe(201);
  });

  it('does not open a second case for a duplicate append', async () => {
    expect((await appendPOST(req(signed({ outcome: 'refunded' })))).status).toBe(201);
    expect((await appendPOST(req(signed({ outcome: 'refunded' })))).status).toBe(409);
    expect(await refundStore.list()).toHaveLength(1);
  });
});

describe('minReceive binding (SLP004)', () => {
  function makeOutcomeIntent(overrides: Partial<OutcomeIntent> = {}): OutcomeIntent {
    return {
      type: 'offramp-outcome',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      sender: sender.publicKey(),
      recipient: '0123456789',
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      transactionId: 'tx-12345',
      minReceive: '145000',
      ...overrides,
    };
  }

  it('valid -> 201, stored row has minReceive', async () => {
    const kp = Keypair.random();
    const intent = makeOutcomeIntent({ sender: kp.publicKey(), minReceive: '145000' });
    const intentHash = await hashIntent(intent);
    const body = {
      ...outcome({
        intentHash,
        minReceive: '145000',
        outcomeIntent: intent,
      }),
      publicKey: kp.publicKey(),
      signature: signRaw(intentHash, kp),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(201);
    const [row] = await store.query({ includeUnattested: true });
    expect(row?.minReceive).toBe('145000');
  });

  it('minReceive without outcomeIntent -> 400', async () => {
    const kp = Keypair.random();
    const intentHash = HASH;
    const body = {
      ...outcome({
        intentHash,
        minReceive: '145000',
      }),
      publicKey: kp.publicKey(),
      signature: signRaw(intentHash, kp),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/minReceive must be covered by the signed outcomeIntent/i);
  });

  it('outcomeIntent.minReceive differs -> 400', async () => {
    const kp = Keypair.random();
    const intent = makeOutcomeIntent({ sender: kp.publicKey(), minReceive: '140000' });
    const intentHash = await hashIntent(intent);
    const body = {
      ...outcome({
        intentHash,
        minReceive: '145000',
        outcomeIntent: intent,
      }),
      publicKey: kp.publicKey(),
      signature: signRaw(intentHash, kp),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(400);
  });

  it('extra key in outcomeIntent -> 400 (strict)', async () => {
    const kp = Keypair.random();
    const intent = {
      ...makeOutcomeIntent({ sender: kp.publicKey() }),
      unexpectedExtra: 'forbidden',
    };
    const intentHash = await hashIntent(intent as OutcomeIntent);
    const body = {
      ...outcome({
        intentHash,
        minReceive: '145000',
        outcomeIntent: intent,
      }),
      publicKey: kp.publicKey(),
      signature: signRaw(intentHash, kp),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(400);
  });

  it('outcomeIntent for a different hash (signature valid over intentHash) -> 400 and nothing stored', async () => {
    const kp = Keypair.random();
    const intent1 = makeOutcomeIntent({ sender: kp.publicKey(), transactionId: 'tx-1' });
    const intent2 = makeOutcomeIntent({ sender: kp.publicKey(), transactionId: 'tx-2' });
    const intentHash1 = await hashIntent(intent1);
    // Body has intentHash1 and signature over intentHash1, but outcomeIntent is intent2
    const body = {
      ...outcome({
        intentHash: intentHash1,
        minReceive: '145000',
        outcomeIntent: intent2,
      }),
      publicKey: kp.publicKey(),
      signature: signRaw(intentHash1, kp),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('VALIDATION_ERROR');
    expect(data.message).toBe('outcomeIntent does not hash to intentHash');

    const rows = await store.query({ includeUnattested: true });
    expect(rows).toHaveLength(0);
  });

  it('sender != publicKey -> 400', async () => {
    const kp1 = Keypair.random();
    const kp2 = Keypair.random();
    const intent = makeOutcomeIntent({ sender: kp1.publicKey() });
    const intentHash = await hashIntent(intent);
    const body = {
      ...outcome({
        intentHash,
        minReceive: '145000',
        outcomeIntent: intent,
      }),
      publicKey: kp2.publicKey(),
      signature: signRaw(intentHash, kp2),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(400);
  });

  it('direction: deposit with minReceive -> 400', async () => {
    const kp = Keypair.random();
    const intent = makeOutcomeIntent({ sender: kp.publicKey() });
    const intentHash = await hashIntent(intent);
    const body = {
      ...outcome({
        intentHash,
        direction: 'deposit',
        minReceive: '145000',
        outcomeIntent: intent,
      }),
      publicKey: kp.publicKey(),
      signature: signRaw(intentHash, kp),
    };

    const res = await appendPOST(req(body));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/minReceive is only supported for withdrawals/i);
  });

  it('neither field -> 201 with minReceive null (regression)', async () => {
    const res = await appendPOST(req(signed()));
    expect(res.status).toBe(201);
    const [row] = await store.query({ includeUnattested: true });
    expect(row?.minReceive).toBeNull();
  });

  it('the logger never receives recipient', async () => {
    const kp = Keypair.random();
    const recipientSecret = 'SECRET_RECIPIENT_XYZ_987654';
    const intent = makeOutcomeIntent({
      sender: kp.publicKey(),
      recipient: recipientSecret,
      minReceive: '145000',
    });
    const intentHash = await hashIntent(intent);
    const body = {
      ...outcome({
        intentHash,
        minReceive: '145000',
        outcomeIntent: intent,
      }),
      publicKey: kp.publicKey(),
      signature: signRaw(intentHash, kp),
    };

    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await appendPOST(req(body));

    for (const call of [...spy.mock.calls, ...warnSpy.mock.calls]) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(recipientSecret);
    }
  });
});
