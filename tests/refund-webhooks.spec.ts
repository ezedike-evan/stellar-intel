// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/refunds/ack/route';
import { openRefundCaseForOutcome } from '@/lib/refunds/detect';
import { InMemoryRefundStore, _setRefundStore, type RefundCase } from '@/lib/refunds/store';
import {
  REFUND_ACK_TYPE,
  REFUND_ACK_VERSION,
  hashRefundAck,
  type RefundAckPayload,
} from '@/lib/refunds/ack';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { _setWebhookEmitter } from '@/lib/webhooks/emit';
import { WEBHOOK_PAYLOAD_SCHEMAS } from '@/types/webhooks';
import type { OutcomeLogRow } from '@/types/reputation';

const SIGNER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
/** Any Stellar account id (G + 55 base32 chars) anywhere in a serialized payload. */
const G_ACCOUNT = /G[A-Z2-7]{55}/;

function row(overrides: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    quotedRate: '1500.0',
    deliveredRate: null,
    quotedAmount: '100',
    deliveredAmount: null,
    settleSeconds: null,
    outcome: 'error',
    createdAt: '2026-11-21T10:00:00.000Z',
    stellarTransactionId: 'b'.repeat(64),
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: SIGNER,
    ...overrides,
  };
}

function expectNoAccountLeak(payload: Record<string, unknown>): void {
  expect(payload).not.toHaveProperty('signerAccount');
  expect(payload).not.toHaveProperty('ackSignature');
  expect(payload).not.toHaveProperty('ackHash');
  expect(JSON.stringify(payload)).not.toMatch(G_ACCOUNT);
}

describe('refund webhook events (#2124)', () => {
  const emitter = vi.fn();

  beforeEach(() => {
    emitter.mockReset();
    _setWebhookEmitter(emitter);
    clearRateLimitStore();
  });

  afterEach(() => {
    _setWebhookEmitter(null);
    _setRefundStore(null);
    clearRateLimitStore();
  });

  describe('refund.opened', () => {
    it('emits once with exactly the listed keys when a case is opened', async () => {
      const store = new InMemoryRefundStore();
      const opened = await openRefundCaseForOutcome(row(), store);
      expect(opened).not.toBeNull();

      expect(emitter).toHaveBeenCalledTimes(1);
      const [kind, payload, opts] = emitter.mock.calls[0]!;
      expect(kind).toBe('refund.opened');
      expect(Object.keys(payload).sort()).toEqual(
        [
          'caseId',
          'intentHash',
          'anchorId',
          'corridor',
          'direction',
          'reason',
          'status',
          'openedAt',
        ].sort()
      );
      expect(payload).toEqual({
        caseId: opened!.id,
        intentHash: 'a'.repeat(64),
        anchorId: 'cowrie',
        corridor: 'usdc-ngn',
        direction: 'withdraw',
        reason: 'anchor_error_after_payment',
        status: 'owed',
        openedAt: opened!.openedAt,
      });
      expect(opts).toEqual({ idempotencyKey: `refund.opened:${opened!.id}` });
      expect(WEBHOOK_PAYLOAD_SCHEMAS['refund.opened'].safeParse(payload).success).toBe(true);
      expectNoAccountLeak(payload);
    });

    it('emits nothing for a duplicate open', async () => {
      const store = new InMemoryRefundStore();
      await openRefundCaseForOutcome(row(), store);
      emitter.mockClear();

      expect(await openRefundCaseForOutcome(row(), store)).toBeNull();
      expect(emitter).not.toHaveBeenCalled();
    });

    it('emits nothing when the outcome implies no refund', async () => {
      const store = new InMemoryRefundStore();
      expect(await openRefundCaseForOutcome(row({ outcome: 'completed' }), store)).toBeNull();
      expect(emitter).not.toHaveBeenCalled();
    });
  });

  describe('refund.acknowledged', () => {
    it('emits after a successful acknowledgement, without the signer or proof', async () => {
      const signer = Keypair.random();
      const store = new InMemoryRefundStore();
      _setRefundStore(store);

      const intentHash = '1'.repeat(64);
      const caseRecord: RefundCase = {
        id: crypto.randomUUID(),
        intentHash,
        reason: 'anchor_refunded',
        anchorId: 'cowrie',
        corridor: 'usdc-ngn',
        direction: 'withdraw',
        signerAccount: signer.publicKey(),
        amountPaid: '100.00',
        status: 'refunded',
        amountRefunded: null,
        refundFee: null,
        payments: [],
        openedAt: '2026-11-20T10:00:00.000Z',
        refundedAt: '2026-11-20T10:00:00.000Z',
        acknowledgedAt: null,
        ackHash: null,
        ackSignature: null,
        onChainCheck: null,
      };
      await store.open(caseRecord);

      const ack: RefundAckPayload = {
        type: REFUND_ACK_TYPE,
        version: REFUND_ACK_VERSION,
        intentHash,
        anchorId: 'cowrie',
        account: signer.publicKey(),
        amountRefunded: '99.50',
        refundFee: '0.50',
        payments: [{ id: 'pay-1', idType: 'stellar', amount: '99.50' }],
      };
      const hash = await hashRefundAck(ack);
      const signature = Buffer.from(signer.signMessage(hash)).toString('base64');

      const res = await POST(
        new NextRequest('http://localhost:3000/api/refunds/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
          body: JSON.stringify({ ack, signature }),
        })
      );
      expect(res.status).toBe(200);

      expect(emitter).toHaveBeenCalledTimes(1);
      const [kind, payload, opts] = emitter.mock.calls[0]!;
      expect(kind).toBe('refund.acknowledged');
      expect(Object.keys(payload).sort()).toEqual(
        ['caseId', 'intentHash', 'anchorId', 'acknowledgedAt', 'onChainCheck'].sort()
      );
      expect(payload).toMatchObject({
        caseId: caseRecord.id,
        intentHash,
        anchorId: 'cowrie',
        onChainCheck: null,
      });
      expect(opts).toEqual({ idempotencyKey: `refund.acknowledged:${caseRecord.id}` });
      expect(WEBHOOK_PAYLOAD_SCHEMAS['refund.acknowledged'].safeParse(payload).success).toBe(true);
      expectNoAccountLeak(payload);
      expect(JSON.stringify(payload)).not.toContain(signature);
    });

    it('emits nothing when the acknowledgement is refused', async () => {
      _setRefundStore(new InMemoryRefundStore());
      const res = await POST(
        new NextRequest('http://localhost:3000/api/refunds/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.21' },
          body: JSON.stringify({
            ack: {
              type: REFUND_ACK_TYPE,
              version: REFUND_ACK_VERSION,
              intentHash: '2'.repeat(64),
              anchorId: 'cowrie',
              account: SIGNER,
              amountRefunded: '1',
              refundFee: '0',
              payments: [],
            },
            signature: 'AAAA',
          }),
        })
      );
      expect(res.status).toBe(404);
      expect(emitter).not.toHaveBeenCalled();
    });
  });
});
