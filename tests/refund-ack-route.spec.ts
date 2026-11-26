// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';

const { fetchPaymentsMock } = vi.hoisted(() => ({
  fetchPaymentsMock: vi.fn(),
}));

vi.mock('@/lib/reputation/reconcile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reputation/reconcile')>();
  return { ...actual, fetchPaymentsForTransaction: fetchPaymentsMock };
});

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/refunds/ack/route';
import { InMemoryRefundStore, _setRefundStore, type RefundCase } from '@/lib/refunds/store';
import {
  REFUND_ACK_TYPE,
  REFUND_ACK_VERSION,
  type RefundAckPayload,
  hashRefundAck,
} from '@/lib/refunds/ack';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeIntentHash(char = 'a'): string {
  return char.repeat(64);
}

function makeCase(overrides: Partial<RefundCase> = {}): RefundCase {
  return {
    id: crypto.randomUUID(),
    intentHash: makeIntentHash('a'),
    reason: 'anchor_error_after_payment',
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    signerAccount: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amountPaid: '100.00',
    status: 'owed',
    amountRefunded: null,
    refundFee: null,
    payments: [],
    openedAt: '2026-10-01T10:00:00.000Z',
    refundedAt: null,
    acknowledgedAt: null,
    ackHash: null,
    ackSignature: null,
    onChainCheck: null,
    ...overrides,
  };
}

function makePayload(overrides: Partial<RefundAckPayload> = {}): RefundAckPayload {
  return {
    type: REFUND_ACK_TYPE,
    version: REFUND_ACK_VERSION,
    intentHash: makeIntentHash('a'),
    anchorId: 'cowrie',
    account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amountRefunded: '100.00',
    refundFee: '0.50',
    payments: [
      {
        id: 'pay-1',
        idType: 'stellar',
        amount: '99.50',
      },
    ],
    ...overrides,
  };
}

function signSep53(keypair: Keypair, hash: string): string {
  const sig = keypair.signMessage(hash);
  return Buffer.from(sig).toString('base64');
}

function signRaw(keypair: Keypair, hash: string): string {
  const sig = keypair.sign(Buffer.from(hash, 'hex'));
  return Buffer.from(sig).toString('base64');
}

function makePostRequest(body: unknown, ip = '203.0.113.10'): NextRequest {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/refunds/ack', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: rawBody,
  });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('POST /api/refunds/ack (Issue #2117 / RFD006)', () => {
  let store: InMemoryRefundStore;
  let signer: Keypair;

  beforeEach(() => {
    clearRateLimitStore();
    store = new InMemoryRefundStore();
    _setRefundStore(store);
    signer = Keypair.random();
    fetchPaymentsMock.mockReset();
    fetchPaymentsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    _setRefundStore(null);
    clearRateLimitStore();
  });

  // ─── 200 Happy Path ─────────────────────────────────────────────────────────

  it('200: records acknowledgement with SEP-53 message signature and sanitizes output', async () => {
    const intentHash = makeIntentHash('1');
    const caseRecord = makeCase({
      intentHash,
      signerAccount: signer.publicKey(),
      amountPaid: '150.00',
      status: 'owed',
    });
    await store.open(caseRecord);

    const ack = makePayload({
      intentHash,
      account: signer.publicKey(),
      amountRefunded: '145.00',
      refundFee: '5.00',
    });

    const hash = await hashRefundAck(ack);
    const signature = signSep53(signer, hash);

    const request = makePostRequest({ ack, signature });
    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();

    // Verify response fields
    expect(json).toEqual({
      id: caseRecord.id,
      intentHash,
      status: 'acknowledged',
      acknowledgedAt: expect.any(String),
      // 'pay-1' is not a Stellar transaction hash, so the on-chain check mismatches.
      onChainCheck: 'mismatch',
    });

    // Verify zero leakage in response
    expect(json).not.toHaveProperty('signature');
    expect(json).not.toHaveProperty('ackSignature');
    expect(json).not.toHaveProperty('signerAccount');
    expect(Object.keys(json).sort()).toEqual([
      'acknowledgedAt',
      'id',
      'intentHash',
      'onChainCheck',
      'status',
    ]);

    // Verify store state transition
    const stored = await store.get(caseRecord.id);
    expect(stored?.status).toBe('acknowledged');
    expect(stored?.amountRefunded).toBe('145.00');
    expect(stored?.refundFee).toBe('5.00');
    expect(stored?.ackHash).toBe(hash);
    expect(stored?.ackSignature).toBe(signature);
    expect(stored?.acknowledgedAt).toBeTruthy();
  });

  it('200: records acknowledgement with raw Ed25519 signature', async () => {
    const intentHash = makeIntentHash('2');
    const caseRecord = makeCase({
      intentHash,
      signerAccount: signer.publicKey(),
      amountPaid: '200.00',
      status: 'refunded',
      refundedAt: '2026-10-02T10:00:00.000Z',
    });
    await store.open(caseRecord);

    const ack = makePayload({
      intentHash,
      account: signer.publicKey(),
      amountRefunded: '200.00',
      refundFee: '0.00',
    });

    const hash = await hashRefundAck(ack);
    const signature = signRaw(signer, hash);

    const request = makePostRequest({ ack, signature });
    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe('acknowledged');
    expect(json.id).toBe(caseRecord.id);

    const stored = await store.get(caseRecord.id);
    expect(stored?.status).toBe('acknowledged');
    // Pre-existing refundedAt is preserved
    expect(stored?.refundedAt).toBe('2026-10-02T10:00:00.000Z');
  });

  it('200: selects the oldest non-acknowledged case when multiple exist', async () => {
    const intentHash = makeIntentHash('3');
    const case1 = makeCase({
      id: 'c-1',
      intentHash,
      reason: 'anchor_error_after_payment',
      signerAccount: signer.publicKey(),
      amountPaid: '50.00',
      status: 'acknowledged',
      openedAt: '2026-10-01T10:00:00.000Z',
      acknowledgedAt: '2026-10-01T11:00:00.000Z',
    });
    const case2 = makeCase({
      id: 'c-2',
      intentHash,
      reason: 'expired_after_payment',
      signerAccount: signer.publicKey(),
      amountPaid: '60.00',
      status: 'owed',
      openedAt: '2026-10-02T10:00:00.000Z',
    });
    const case3 = makeCase({
      id: 'c-3',
      intentHash,
      reason: 'slippage_breach',
      signerAccount: signer.publicKey(),
      amountPaid: '70.00',
      status: 'owed',
      openedAt: '2026-10-03T10:00:00.000Z',
    });
    await store.open(case1);
    await store.open(case2);
    await store.open(case3);

    const ack = makePayload({
      intentHash,
      account: signer.publicKey(),
      amountRefunded: '60.00',
    });
    const hash = await hashRefundAck(ack);
    const signature = signSep53(signer, hash);

    const response = await POST(makePostRequest({ ack, signature }));
    expect(response.status).toBe(200);
    const json = await response.json();
    // case2 was oldest non-acknowledged
    expect(json.id).toBe('c-2');
  });

  // ─── On-chain verification (Issue #2118) ────────────────────────────────────

  describe('on-chain refund verification', () => {
    const TX = 'c'.repeat(64);

    async function postSignedAck(intentHash: string, direction: 'withdraw' | 'deposit') {
      const caseRecord = makeCase({
        intentHash,
        signerAccount: signer.publicKey(),
        corridor: 'usdc-ngn',
        direction,
        amountPaid: '100.00',
      });
      await store.open(caseRecord);

      const ack = makePayload({
        intentHash,
        account: signer.publicKey(),
        amountRefunded: '100.00',
        refundFee: '0.50',
        payments: [{ id: TX, idType: 'stellar', amount: '99.50' }],
      });
      const hash = await hashRefundAck(ack);
      const signature = signSep53(signer, hash);
      const response = await POST(makePostRequest({ ack, signature }));
      return { response, caseRecord };
    }

    it("withdraw: matching Horizon record → onChainCheck 'verified'", async () => {
      fetchPaymentsMock.mockResolvedValue([
        {
          type: 'payment',
          amount: '99.5000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          to: signer.publicKey(),
          from: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        },
      ]);

      const { response, caseRecord } = await postSignedAck(makeIntentHash('c'), 'withdraw');
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.onChainCheck).toBe('verified');
      expect(fetchPaymentsMock).toHaveBeenCalledWith(TX);

      const stored = await store.get(caseRecord.id);
      expect(stored?.onChainCheck).toBe('verified');
    });

    it("withdraw: no Horizon records → 'mismatch' and the ack is still recorded", async () => {
      fetchPaymentsMock.mockResolvedValue([]);

      const { response, caseRecord } = await postSignedAck(makeIntentHash('d'), 'withdraw');
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.onChainCheck).toBe('mismatch');

      const stored = await store.get(caseRecord.id);
      expect(stored?.status).toBe('acknowledged');
      expect(stored?.onChainCheck).toBe('mismatch');
    });

    it("deposit: stores 'unverifiable' without calling Horizon", async () => {
      const { response, caseRecord } = await postSignedAck(makeIntentHash('e'), 'deposit');
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.onChainCheck).toBe('unverifiable');
      expect(fetchPaymentsMock).not.toHaveBeenCalled();

      const stored = await store.get(caseRecord.id);
      expect(stored?.onChainCheck).toBe('unverifiable');
    });
  });

  // ─── 400 Bad Request ────────────────────────────────────────────────────────

  it('400: rejects malformed JSON with RFC 9457 error', async () => {
    const request = makePostRequest('{ invalid json string');
    const response = await POST(request);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.status).toBe(400);
    expect(json.title).toBe('Invalid JSON');
    expect(json.type).toBe('https://stellar-intel.com/errors/invalid-json');
  });

  // ─── 401 Unauthorized ───────────────────────────────────────────────────────

  it('401: rejects invalid cryptographic signature', async () => {
    const intentHash = makeIntentHash('4');
    await store.open(
      makeCase({
        intentHash,
        signerAccount: signer.publicKey(),
      })
    );

    const ack = makePayload({
      intentHash,
      account: signer.publicKey(),
    });

    const badSignature = Buffer.from('a'.repeat(64)).toString('base64');

    const response = await POST(makePostRequest({ ack, signature: badSignature }));
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.title).toBe('Unauthorized');
    expect(json.detail).toBe('Invalid signature for refund acknowledgement');
  });

  it('401: rejects signature created by wrong keypair', async () => {
    const intentHash = makeIntentHash('5');
    await store.open(
      makeCase({
        intentHash,
        signerAccount: signer.publicKey(),
      })
    );

    const otherSigner = Keypair.random();
    const ack = makePayload({
      intentHash,
      account: signer.publicKey(),
    });

    const hash = await hashRefundAck(ack);
    // Signed by otherSigner, but ack.account is signer.publicKey()
    const signature = signSep53(otherSigner, hash);

    const response = await POST(makePostRequest({ ack, signature }));
    expect(response.status).toBe(401);
  });

  it('401: rejects tampered payload where amountRefunded was modified after signing', async () => {
    const intentHash = makeIntentHash('6');
    await store.open(
      makeCase({
        intentHash,
        signerAccount: signer.publicKey(),
        amountPaid: '100.00',
      })
    );

    const originalAck = makePayload({
      intentHash,
      account: signer.publicKey(),
      amountRefunded: '50.00',
    });
    const hash = await hashRefundAck(originalAck);
    const signature = signSep53(signer, hash);

    // Tamper with payload
    const tamperedAck = { ...originalAck, amountRefunded: '90.00' };

    const response = await POST(makePostRequest({ ack: tamperedAck, signature }));
    expect(response.status).toBe(401);
  });

  // ─── 403 Forbidden ──────────────────────────────────────────────────────────

  it('403: rejects acknowledgement when signer does not match case signerAccount', async () => {
    const intentHash = makeIntentHash('7');
    const caseSigner = Keypair.random();
    await store.open(
      makeCase({
        intentHash,
        signerAccount: caseSigner.publicKey(),
      })
    );

    const attackerSigner = Keypair.random();
    const ack = makePayload({
      intentHash,
      account: attackerSigner.publicKey(),
    });
    const hash = await hashRefundAck(ack);
    const signature = signSep53(attackerSigner, hash);

    const response = await POST(makePostRequest({ ack, signature }));
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.title).toBe('Forbidden');
    expect(json.detail).toBe(
      'Only the account that signed the transfer can acknowledge its refund'
    );
  });

  // ─── 404 Not Found ──────────────────────────────────────────────────────────

  it('404: returns error when intentHash has no refund cases', async () => {
    const unknownHash = makeIntentHash('8');
    const ack = makePayload({
      intentHash: unknownHash,
      account: signer.publicKey(),
    });
    const hash = await hashRefundAck(ack);
    const signature = signSep53(signer, hash);

    const response = await POST(makePostRequest({ ack, signature }));
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.title).toBe('No Refund Case');
  });

  // ─── 409 Conflict ───────────────────────────────────────────────────────────

  it('409: returns conflict on double acknowledgement attempt', async () => {
    const intentHash = makeIntentHash('9');
    await store.open(
      makeCase({
        intentHash,
        signerAccount: signer.publicKey(),
        status: 'acknowledged',
        acknowledgedAt: '2026-10-01T10:00:00.000Z',
      })
    );

    const ack = makePayload({
      intentHash,
      account: signer.publicKey(),
    });
    const hash = await hashRefundAck(ack);
    const signature = signSep53(signer, hash);

    const response = await POST(makePostRequest({ ack, signature }));
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.title).toBe('Already Acknowledged');
  });

  // ─── 422 Unprocessable Entity ───────────────────────────────────────────────

  it('422: rejects body with extra top-level fields (strictness)', async () => {
    const ack = makePayload();
    const response = await POST(
      makePostRequest({
        ack,
        signature: 'sig',
        unexpectedField: 'malicious',
      })
    );

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.title).toBe('Validation Error');
  });

  it('422: rejects body with invalid ack schema (e.g. invalid type or version)', async () => {
    const badAck = {
      ...makePayload(),
      type: 'invalid-type',
    };
    const response = await POST(
      makePostRequest({
        ack: badAck,
        signature: 'sig',
      })
    );

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.title).toBe('Validation Error');
  });

  it('422: rejects when anchorId does not match case record', async () => {
    const intentHash = makeIntentHash('a');
    await store.open(
      makeCase({
        intentHash,
        anchorId: 'cowrie',
        signerAccount: signer.publicKey(),
      })
    );

    const ack = makePayload({
      intentHash,
      anchorId: 'moneygram', // mismatch
      account: signer.publicKey(),
    });
    const hash = await hashRefundAck(ack);
    const signature = signSep53(signer, hash);

    const response = await POST(makePostRequest({ ack, signature }));
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.detail).toBe('Anchor ID mismatch');
  });

  it('422: rejects when amountRefunded exceeds amountPaid', async () => {
    const intentHash = makeIntentHash('b');
    await store.open(
      makeCase({
        intentHash,
        signerAccount: signer.publicKey(),
        amountPaid: '100.00',
      })
    );

    const ack = makePayload({
      intentHash,
      account: signer.publicKey(),
      amountRefunded: '100.0000001', // exceeds amountPaid
    });
    const hash = await hashRefundAck(ack);
    const signature = signSep53(signer, hash);

    const response = await POST(makePostRequest({ ack, signature }));
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.detail).toBe('amountRefunded exceeds the amount paid');
  });

  // ─── 429 Too Many Requests ──────────────────────────────────────────────────

  it('429: enforces rate limit after 20 requests', async () => {
    const ip = '198.51.100.42';

    // Fire 20 requests
    for (let i = 0; i < 20; i++) {
      const res = await POST(makePostRequest('{ bad', ip));
      expect(res.status).toBe(400);
    }

    // 21st request should be rate-limited
    const limitedRes = await POST(makePostRequest('{ bad', ip));
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get('Retry-After')).toBeTruthy();
    expect(limitedRes.headers.get('X-RateLimit-Limit')).toBe('20');
    expect(limitedRes.headers.get('X-RateLimit-Remaining')).toBe('0');
  });
});
