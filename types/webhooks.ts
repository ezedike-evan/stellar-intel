/**
 * The payload of every webhook event kind, as a strict zod schema.
 *
 * Never put in a payload: `sender`, `recipient`, `publicKey`, `signature`, the text
 * of a dispute `reason`, or a JWT. A payload leaves the platform for an endpoint we
 * do not control. Every schema is strict, so a key that is not listed is refused
 * rather than passed along.
 */
import { z } from 'zod';
import { OUTCOME_STATUSES } from '@/types/reputation';

/** An intent hash: SHA-256 as 64 lower-case hex characters. */
const IntentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Which way an intent moves money, as the intent routes name it. */
const IntentDirectionSchema = z.enum(['offramp', 'onramp']);

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

/** An intent that was refused before it was routed. The reason is a code, never free text. */
export const IntentRejectedPayloadSchema = z
  .object({
    intentHash: IntentHashSchema,
    direction: IntentDirectionSchema,
    reason: z.enum(['invalid_signature', 'missing_replay_fields', 'replay_detected', 'no_route']),
    sourceAsset: z.string(),
    destinationAsset: z.string(),
    amount: z.string(),
  })
  .strict();

/** An intent whose deadline passed before it settled. */
export const IntentExpiredPayloadSchema = z
  .object({
    intentHash: IntentHashSchema,
    direction: IntentDirectionSchema,
    deadline: z.iso.datetime(),
    sourceAsset: z.string(),
    destinationAsset: z.string(),
    amount: z.string(),
  })
  .strict();

/**
 * An anchor transaction moved from one status to another. `from` is null for the
 * first status seen, and `intentHash` is null when the transaction has no intent.
 */
export const SettlementStatusChangedPayloadSchema = z
  .object({
    anchorId: z.string(),
    transactionId: z.string(),
    protocol: z.enum(['sep24', 'sep6']),
    direction: z.enum(['withdraw', 'deposit']),
    from: z.string().nullable(),
    to: z.string(),
    terminal: z.boolean(),
    intentHash: IntentHashSchema.nullable(),
    observedAt: z.iso.datetime(),
  })
  .strict();

/** A dispute was opened. Who opened it and what they wrote are not part of the event. */
export const DisputeOpenedPayloadSchema = z
  .object({
    disputeId: z.string(),
    intentHash: IntentHashSchema,
    anchorId: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();

/** A dispute was decided. */
export const DisputeResolvedPayloadSchema = z
  .object({
    disputeId: z.string(),
    intentHash: IntentHashSchema,
    anchorId: z.string(),
    status: z.enum(['accepted', 'rejected']),
    resolvedAt: z.iso.datetime(),
  })
  .strict();

/** The oracle publisher wrote a batch on chain. `txHash` is null when nothing was submitted. */
export const OraclePublishedPayloadSchema = z
  .object({
    network: z.string(),
    contractId: z.string(),
    txHash: z.string().nullable(),
    outcomesPublished: z.number().int().min(0),
    corridorRatesPublished: z.number().int().min(0),
    corridorMetricsPublished: z.number().int().min(0),
    probeSignalsPublished: z.number().int().min(0),
    publishedAt: z.iso.datetime(),
  })
  .strict();

/**
 * A recorded outcome delivered less than the intent's `minReceive`. The payload is
 * built from the breach record field by field: its `signerAccount`, `evidence` and
 * `anchorTransactionId` stay on the platform. `evidenceHash` identifies that evidence
 * without carrying it.
 */
export const IntentSlippageBreachPayloadSchema = z
  .object({
    intentHash: IntentHashSchema,
    anchorId: z.string(),
    corridor: z.string(),
    minReceive: z.string(),
    amountOut: z.string(),
    shortfall: z.string(),
    shortfallBps: z.number().int().min(0),
    evidenceHash: z.string(),
    status: z.literal('detected'),
    detectedAt: z.iso.datetime(),
  })
  .strict();

export const WEBHOOK_PAYLOAD_SCHEMAS = {
  'intent.created': IntentCreatedPayloadSchema,
  'intent.settled': IntentSettledPayloadSchema,
  'intent.failed': IntentFailedPayloadSchema,
  'reputation.event_written': ReputationEventWrittenPayloadSchema,
  'anchor.health_status_changed': AnchorHealthStatusChangedPayloadSchema,
  'intent.rejected': IntentRejectedPayloadSchema,
  'intent.expired': IntentExpiredPayloadSchema,
  'settlement.status_changed': SettlementStatusChangedPayloadSchema,
  'dispute.opened': DisputeOpenedPayloadSchema,
  'dispute.resolved': DisputeResolvedPayloadSchema,
  'oracle.published': OraclePublishedPayloadSchema,
  'intent.slippage_breach': IntentSlippageBreachPayloadSchema,
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
    idempotencyKey: z.string().min(1).max(200),
    payload: IntentCreatedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('intent.settled'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: IntentSettledPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('intent.failed'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: IntentFailedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('reputation.event_written'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: ReputationEventWrittenPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('anchor.health_status_changed'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: AnchorHealthStatusChangedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('intent.rejected'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: IntentRejectedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('intent.expired'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: IntentExpiredPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('settlement.status_changed'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: SettlementStatusChangedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('dispute.opened'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: DisputeOpenedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('dispute.resolved'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: DisputeResolvedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('oracle.published'),
    createdAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200),
    payload: OraclePublishedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('intent.slippage_breach'),
    createdAt: z.iso.datetime(),
    payload: IntentSlippageBreachPayloadSchema,
  }),
]);
