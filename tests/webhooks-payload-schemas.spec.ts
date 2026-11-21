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
};

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
