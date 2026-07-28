import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { STELLAR_PUBKEY_PATTERN, AMOUNT_PATTERN, AMOUNT_7DP_PATTERN } from '@/lib/patterns';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ─── Schemas (mirrors types/intent.ts — OpenAPI layer only) ───────────────────

const OfframpIntentSchema = registry.register(
  'OfframpIntent',
  z.object({
    anchorId: z.string().min(1),
    corridorId: z.string().min(1),
    amount: z.string().regex(AMOUNT_7DP_PATTERN),
    publicKey: z.string().regex(STELLAR_PUBKEY_PATTERN),
  })
);

const SignedIntentEnvelopeSchema = registry.register(
  'SignedIntentEnvelope',
  z.object({
    intent: OfframpIntentSchema,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().min(1),
    publicKey: z.string().regex(STELLAR_PUBKEY_PATTERN),
  })
);

registry.register(
  'IntentV1',
  z.object({
    id: z.string().min(1),
    from: z.string().min(1).describe('Source asset identifier (e.g. "stellar:USDC:GA5...")'),
    to: z.string().min(1).describe('Destination fiat identifier (e.g. "iso4217:NGN")'),
    amount: z.string().regex(AMOUNT_PATTERN),
    floor: z.string().regex(AMOUNT_PATTERN),
    deadline: z.string().describe('RFC 3339 datetime after which the intent must not execute'),
    recipient: z.string().min(1),
    nonce: z
      .string()
      .regex(/^[0-9a-f]{32}$/i)
      .describe('128-bit random hex for replay protection'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
);

const OfframpRouteSchema = registry.register(
  'OfframpRoute',
  z.object({
    anchorId: z.string(),
    anchorDomain: z.string(),
    corridorId: z.string(),
    estimatedFee: z.string(),
    estimatedReceived: z.string(),
  })
);

const OfframpIntentResponseSchema = registry.register(
  'OfframpIntentResponse',
  z.object({
    route: OfframpRouteSchema,
    unsignedTx: z.string().describe('XDR-encoded unsigned Stellar transaction'),
    quoteId: z.string().describe('Hex-encoded SHA-256 quote identifier'),
  })
);

const ApiErrorSchema = registry.register(
  'ApiError',
  z.object({
    code: z.string().describe('Machine-readable error code'),
    message: z.string().describe('Human-readable error description'),
  })
);

const IntentRequestSchema = registry.register(
  'IntentRequest',
  z.object({
    type: z.literal('offramp'),
    sourceAsset: z.string().min(1),
    destinationAsset: z.string().min(1),
    amount: z.string().regex(AMOUNT_PATTERN),
    sender: z.string().min(1).describe('Stellar public key of the sender'),
    recipient: z.string().min(1).describe('Destination address for the payout'),
  })
);

const AnchorHealthResponseSchema = registry.register(
  'AnchorHealthResponse',
  z.object({
    anchorId: z.string().describe('Unique anchor identifier'),
    status: z
      .enum(['ok', 'fail', 'unknown', 'stale'])
      .describe('Current health status: ok, fail, unknown (never checked), or stale (last check >24h ago)'),
    consecutiveFailures: z.number().describe('Consecutive nightly validation failures'),
    degraded: z.boolean().describe('True when anchor is auto-flagged degraded after repeated failures'),
    lastCheckedAt: z
      .string()
      .nullable()
      .describe('ISO timestamp of the last nightly check, or null if never checked'),
    lastError: z.string().nullable().describe('Failure reason from the last check, or null on success'),
    stale: z.boolean().describe('True when the last probe is older than 24 hours'),
  })
);

// Suppress unused-variable warnings — schemas are referenced only via the registry
void SignedIntentEnvelopeSchema;

// ─── Route registrations ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/intent/offramp',
  summary: 'Submit an off-ramp intent',
  description:
    'Resolves an anchor route for the given asset corridor, builds an unsigned Stellar payment transaction, and returns a quote ID.',
  tags: ['Intent'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: IntentRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Route resolved and unsigned transaction built',
      content: { 'application/json': { schema: OfframpIntentResponseSchema } },
    },
    400: {
      description: 'Validation error or no route found',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    500: {
      description: 'Transaction build failure',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/anchors/{id}/health',
  summary: 'Get anchor health status',
  description:
    "Returns the anchor's current health status, last-probe timestamp, and score breakdown. Returns 'unknown' or 'stale' when probes haven't run recently — honest degradation rather than fabricated data.",
  tags: ['Anchors'],
  request: {
    params: z.object({
      id: z.string().min(1).describe('Anchor identifier (e.g. moneygram, cowrie, anclap)'),
    }),
  },
  responses: {
    200: {
      description: 'Anchor health status',
      content: { 'application/json': { schema: AnchorHealthResponseSchema } },
    },
    400: {
      description: 'Invalid anchor ID',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    404: {
      description: 'Anchor not found',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    429: {
      description: 'Rate limit exceeded',
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
            retryAfter: z.number(),
          }),
        },
      },
    },
  },
});

// ─── Spec builder ──────────────────────────────────────────────────────────────

export function buildOpenApiSpec() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Stellar Intel API',
      version: '1.2.0',
      description: 'Intent router and anchor rate aggregation API for the Stellar Intel platform.',
    },
    servers: [{ url: 'https://stellar-intel.vercel.app', description: 'Production' }],
  });
}
