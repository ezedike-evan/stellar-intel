import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_PAYLOAD_SCHEMAS,
  WebhookEventEnvelopeSchema,
  type WebhookEventPayloadMap,
} from '@/types/webhooks';
import { WEBHOOK_EVENT_KINDS } from '@/lib/webhooks/schema';
import { makeWebhookEvent } from '@/lib/webhooks/events';
import { emitWebhookEvent } from '@/lib/webhooks/emit';

const VALID_PAYLOADS: { [K in keyof WebhookEventPayloadMap]: WebhookEventPayloadMap[K] } = {
  'intent.created': {
    intentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    direction: 'offramp',
    corridorId: 'usdc-ngn',
    anchorId: 'cowrie',
    quoteId: 'q-123',
    amount: '100',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
  },
  'intent.settled': {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    quotedAmount: '100',
    stellarTransactionId: 'b'.repeat(64),
  },
  'intent.failed': {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    outcome: 'refunded',
  },
  'reputation.event_written': {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    outcome: 'completed',
    createdAt: '2026-11-20T12:00:00.000Z',
  },
  'anchor.health_status_changed': {
    anchorId: 'cowrie',
    from: 'healthy',
    to: 'degraded',
    lastCheckedAt: '2026-11-20T12:00:00.000Z',
    lastError: 'timeout',
  },
  'intent.rejected': {
    intentHash: 'a'.repeat(64),
    direction: 'offramp',
    reason: 'replay_detected',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
  },
  'intent.expired': {
    intentHash: 'a'.repeat(64),
    direction: 'onramp',
    deadline: '2026-11-20T12:05:00.000Z',
    sourceAsset: 'NGN',
    destinationAsset: 'USDC',
    amount: '100',
  },
  'settlement.status_changed': {
    anchorId: 'cowrie',
    transactionId: 'txn-abc123',
    protocol: 'sep24',
    direction: 'withdraw',
    from: 'pending_anchor',
    to: 'completed',
    terminal: true,
    intentHash: 'a'.repeat(64),
    observedAt: '2026-11-20T12:00:00.000Z',
  },
  'dispute.opened': {
    disputeId: 'dsp-1',
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    createdAt: '2026-11-20T12:00:00.000Z',
  },
  'dispute.resolved': {
    disputeId: 'dsp-1',
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    status: 'accepted',
    resolvedAt: '2026-11-21T09:30:00.000Z',
  },
  'oracle.published': {
    network: 'mainnet',
    contractId: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
    txHash: 'c'.repeat(64),
    outcomesPublished: 12,
    corridorRatesPublished: 4,
    corridorMetricsPublished: 4,
    probeSignalsPublished: 0,
    publishedAt: '2026-11-20T12:00:00.000Z',
  },
  'intent.slippage_breach': {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    minReceive: '1400',
    amountOut: '1350',
    shortfall: '50',
    shortfallBps: 357,
    evidenceHash: 'd'.repeat(64),
    status: 'detected',
    detectedAt: '2026-11-20T12:00:00.000Z',
  },
  'refund.opened': {
    caseId: '7d0e8a3c-1b2f-4c5d-9e6f-0a1b2c3d4e5f',
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    reason: 'anchor_error_after_payment',
    status: 'owed',
    openedAt: '2026-11-20T12:00:00.000Z',
  },
  'refund.acknowledged': {
    caseId: '7d0e8a3c-1b2f-4c5d-9e6f-0a1b2c3d4e5f',
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    acknowledgedAt: '2026-11-22T12:00:00.000Z',
    onChainCheck: null,
  },
};

/** The kinds WHK003 added, in the order they are registered. */
const ADDED_KINDS = [
  'intent.rejected',
  'intent.expired',
  'settlement.status_changed',
  'dispute.opened',
  'dispute.resolved',
  'oracle.published',
] as const;

/** Whether `payload` passes the schema registered for `kind`. */
const accepts = (kind: keyof WebhookEventPayloadMap, payload: unknown): boolean =>
  WEBHOOK_PAYLOAD_SCHEMAS[kind].safeParse(payload).success;

describe('webhook payload schemas (WHK002)', () => {
  it('accepts each valid producer payload and rejects extra or missing keys', () => {
    for (const kind of WEBHOOK_EVENT_KINDS) {
      const schema = WEBHOOK_PAYLOAD_SCHEMAS[kind];
      const payload = VALID_PAYLOADS[kind];

      expect(schema.safeParse(payload).success).toBe(true);
      expect(schema.safeParse({ ...payload, sender: 'GABC' }).success).toBe(false);

      const firstKey = Object.keys(payload)[0]!;
      const withoutFirst = { ...payload } as Record<string, unknown>;
      delete withoutFirst[firstKey];
      expect(schema.safeParse(withoutFirst).success).toBe(false);
    }
  });

  it('keeps WEBHOOK_EVENT_KINDS equal to WEBHOOK_PAYLOAD_SCHEMAS keys in order', () => {
    expect(WEBHOOK_EVENT_KINDS).toEqual(Object.keys(WEBHOOK_PAYLOAD_SCHEMAS));
  });

  it('validates makeWebhookEvent output against WebhookEventEnvelopeSchema', () => {
    const event = makeWebhookEvent('intent.created', VALID_PAYLOADS['intent.created']);
    expect(WebhookEventEnvelopeSchema.safeParse(event).success).toBe(true);
  });

  it('enforces payload schema keys at compile time on emitWebhookEvent', () => {
    const verifyCompileTimeOnly = () => {
      emitWebhookEvent('intent.created', {
        ...VALID_PAYLOADS['intent.created'],
        // @ts-expect-error unknown key must be rejected by strict payload map
        extraKey: 'nope',
      });
    };
    expect(typeof verifyCompileTimeOnly).toBe('function');
  });
});

describe('the intent, settlement, dispute and oracle kinds (WHK003)', () => {
  it('registers the six kinds after the first five, in order', () => {
    expect(WEBHOOK_EVENT_KINDS).toEqual([
      'intent.created',
      'intent.settled',
      'intent.failed',
      'reputation.event_written',
      'anchor.health_status_changed',
      ...ADDED_KINDS,
      // SLP014 registered one more, after them.
      'intent.slippage_breach',
      // Then the refund kinds (#2124).
      'refund.opened',
      'refund.acknowledged',
    ]);
  });

  it('accepts a valid sample of each added kind', () => {
    for (const kind of ADDED_KINDS) {
      expect(accepts(kind, VALID_PAYLOADS[kind]), kind).toBe(true);
    }
    // The three fields that may be null.
    const settlement = VALID_PAYLOADS['settlement.status_changed'];
    expect(accepts('settlement.status_changed', { ...settlement, from: null })).toBe(true);
    expect(accepts('settlement.status_changed', { ...settlement, intentHash: null })).toBe(true);
    expect(
      accepts('oracle.published', { ...VALID_PAYLOADS['oracle.published'], txHash: null })
    ).toBe(true);
  });

  it('refuses a key that must never leave the platform, on every added kind', () => {
    for (const kind of ADDED_KINDS) {
      for (const key of ['sender', 'recipient', 'publicKey', 'signature', 'jwt']) {
        expect(accepts(kind, { ...VALID_PAYLOADS[kind], [key]: 'GABC' }), `${kind}.${key}`).toBe(
          false
        );
      }
    }
    // A dispute event says that a dispute exists, never what its author wrote.
    for (const kind of ['dispute.opened', 'dispute.resolved'] as const) {
      expect(accepts(kind, { ...VALID_PAYLOADS[kind], reason: 'they never paid' }), kind).toBe(
        false
      );
    }
    // A rejection's reason is one of four codes, not free text.
    expect(
      accepts('intent.rejected', { ...VALID_PAYLOADS['intent.rejected'], reason: 'looked odd' })
    ).toBe(false);
  });

  it("keeps the breach record's private fields out of intent.slippage_breach (SLP014)", () => {
    const breach = VALID_PAYLOADS['intent.slippage_breach'];
    expect(accepts('intent.slippage_breach', breach)).toBe(true);
    for (const key of [
      'signerAccount',
      'evidence',
      'anchorTransactionId',
      'stellarTransactionId',
    ]) {
      expect(accepts('intent.slippage_breach', { ...breach, [key]: 'GABC' }), key).toBe(false);
    }
    // The event reports a detection. A verification result is not this event.
    for (const status of ['verified', 'rejected', 'pending']) {
      expect(accepts('intent.slippage_breach', { ...breach, status }), status).toBe(false);
    }
    expect(accepts('intent.slippage_breach', { ...breach, intentHash: 'A'.repeat(64) })).toBe(
      false
    );
    expect(accepts('intent.slippage_breach', { ...breach, shortfallBps: 3.5 })).toBe(false);
    expect(accepts('intent.slippage_breach', { ...breach, shortfallBps: -1 })).toBe(false);
    expect(accepts('intent.slippage_breach', { ...breach, detectedAt: 'yesterday' })).toBe(false);
  });

  it('takes an intent hash only as 64 lower-case hex characters', () => {
    const hashed = ADDED_KINDS.filter((kind) => 'intentHash' in VALID_PAYLOADS[kind]);
    expect(hashed).toEqual([
      'intent.rejected',
      'intent.expired',
      'settlement.status_changed',
      'dispute.opened',
      'dispute.resolved',
    ]);
    for (const kind of hashed) {
      for (const bad of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), '', 7]) {
        expect(accepts(kind, { ...VALID_PAYLOADS[kind], intentHash: bad }), `${kind} ${bad}`).toBe(
          false
        );
      }
    }
    // Only a settlement may have no intent behind it.
    for (const kind of hashed.filter((k) => k !== 'settlement.status_changed')) {
      expect(accepts(kind, { ...VALID_PAYLOADS[kind], intentHash: null }), kind).toBe(false);
    }
  });

  it('holds every other field to its type', () => {
    const refused: { [K in (typeof ADDED_KINDS)[number]]: Record<string, unknown>[] } = {
      'intent.rejected': [{ direction: 'withdraw' }, { amount: 100 }],
      'intent.expired': [{ direction: 'deposit' }, { deadline: '2026-11-20' }, { deadline: 0 }],
      'settlement.status_changed': [
        { protocol: 'sep31' },
        { direction: 'offramp' },
        { terminal: 'yes' },
        { to: null },
        { from: undefined },
        { observedAt: 'yesterday' },
      ],
      'dispute.opened': [{ createdAt: '20 Nov 2026' }, { disputeId: 1 }],
      'dispute.resolved': [{ status: 'pending' }, { resolvedAt: null }],
      'oracle.published': [
        { outcomesPublished: -1 },
        { corridorRatesPublished: 1.5 },
        { corridorMetricsPublished: '4' },
        { probeSignalsPublished: null },
        { publishedAt: 'now' },
        { txHash: undefined },
      ],
    };
    for (const kind of ADDED_KINDS) {
      for (const change of refused[kind]) {
        expect(
          accepts(kind, { ...VALID_PAYLOADS[kind], ...change }),
          `${kind} ${JSON.stringify(change)}`
        ).toBe(false);
      }
    }
  });

  it('validates an envelope of every kind, and refuses one kind carrying another kind’s payload', () => {
    const envelope = (kind: string, payload: unknown) => ({
      id: '3f2a1b4c-0d5e-4f6a-8b7c-9d0e1f2a3b4c',
      kind,
      createdAt: '2026-11-20T12:00:00.000Z',
      idempotencyKey: `${kind}:3f2a1b4c-0d5e-4f6a-8b7c-9d0e1f2a3b4c`,
      payload,
    });
    for (const kind of WEBHOOK_EVENT_KINDS) {
      expect(
        WebhookEventEnvelopeSchema.safeParse(envelope(kind, VALID_PAYLOADS[kind])).success,
        kind
      ).toBe(true);
    }
    expect(
      WebhookEventEnvelopeSchema.safeParse(
        envelope('dispute.opened', VALID_PAYLOADS['oracle.published'])
      ).success
    ).toBe(false);
    expect(
      WebhookEventEnvelopeSchema.safeParse(
        envelope('dispute.created', VALID_PAYLOADS['dispute.opened'])
      ).success
    ).toBe(false);
  });
});
