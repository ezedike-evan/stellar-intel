import { z } from 'zod';
import { OUTCOME_STATUSES } from '@/types/reputation';

export const IntentCreatedPayloadSchema = z
  .object({
    corridorId: z.string(),
    anchorId: z.string(),
    quoteId: z.string(),
    amount: z.string(),
    sourceAsset: z.string(),
    destinationAsset: z.string(),
  })
  .strict();

export const ReputationEventWrittenPayloadSchema = z
  .object({
    intentHash: z.string(),
    anchorId: z.string(),
    corridor: z.string(),
    outcome: z.enum(OUTCOME_STATUSES),
    createdAt: z.string(),
  })
  .strict();

export const IntentSettledPayloadSchema = z
  .object({
    intentHash: z.string(),
    anchorId: z.string(),
    corridor: z.string(),
    quotedAmount: z.string(),
    stellarTransactionId: z.string().nullable(),
  })
  .strict();

export const IntentFailedPayloadSchema = z
  .object({
    intentHash: z.string(),
    anchorId: z.string(),
    corridor: z.string(),
    outcome: z.enum(['error', 'expired', 'refunded']),
  })
  .strict();

export const AnchorHealthStatusChangedPayloadSchema = z
  .object({
    anchorId: z.string(),
    from: z.enum(['healthy', 'degraded']),
    to: z.enum(['healthy', 'degraded']),
    lastCheckedAt: z.string().nullable(),
    lastError: z.string().nullable(),
  })
  .strict();

export const WEBHOOK_PAYLOAD_SCHEMAS = {
  'intent.created': IntentCreatedPayloadSchema,
  'intent.settled': IntentSettledPayloadSchema,
  'intent.failed': IntentFailedPayloadSchema,
  'reputation.event_written': ReputationEventWrittenPayloadSchema,
  'anchor.health_status_changed': AnchorHealthStatusChangedPayloadSchema,
} as const;

export type WebhookEventKind = keyof typeof WEBHOOK_PAYLOAD_SCHEMAS;

export type WebhookEventPayloadMap = {
  [K in WebhookEventKind]: z.infer<(typeof WEBHOOK_PAYLOAD_SCHEMAS)[K]>;
};

export const WebhookEventEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().uuid(),
    kind: z.literal('intent.created'),
    createdAt: z.iso.datetime(),
    payload: IntentCreatedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('intent.settled'),
    createdAt: z.iso.datetime(),
    payload: IntentSettledPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('intent.failed'),
    createdAt: z.iso.datetime(),
    payload: IntentFailedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('reputation.event_written'),
    createdAt: z.iso.datetime(),
    payload: ReputationEventWrittenPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('anchor.health_status_changed'),
    createdAt: z.iso.datetime(),
    payload: AnchorHealthStatusChangedPayloadSchema,
  }),
]);
