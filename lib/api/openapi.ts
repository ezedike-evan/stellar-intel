import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ─── Schemas (mirrors types/intent.ts — OpenAPI layer only) ───────────────────

const OfframpIntentSchema = registry.register(
  'OfframpIntent',
  z.object({
    anchorId: z.string().min(1),
    corridorId: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d{1,7})?$/),
    publicKey: z.string().regex(/^G[A-Z0-9]{55}$/),
  }),
);

const SignedIntentEnvelopeSchema = registry.register(
  'SignedIntentEnvelope',
  z.object({
    intent: OfframpIntentSchema,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().min(1),
    publicKey: z.string().regex(/^G[A-Z0-9]{55}$/),
  }),
);

registry.register(
  'IntentV1',
  z.object({
    id: z.string().min(1),
    from: z.string().min(1).describe('Source asset identifier (e.g. "stellar:USDC:GA5...")'),
    to: z.string().min(1).describe('Destination fiat identifier (e.g. "iso4217:NGN")'),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    floor: z.string().regex(/^\d+(\.\d+)?$/),
    deadline: z.string().describe('RFC 3339 datetime after which the intent must not execute'),
    recipient: z.string().min(1),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i).describe('128-bit random hex for replay protection'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
);

const OfframpRouteSchema = registry.register(
  'OfframpRoute',
  z.object({
    anchorId: z.string(),
    anchorDomain: z.string(),
    corridorId: z.string(),
    estimatedFee: z.string(),
    estimatedReceived: z.string(),
  }),
);

const OfframpIntentResponseSchema = registry.register(
  'OfframpIntentResponse',
  z.object({
    route: OfframpRouteSchema,
    unsignedTx: z.string().describe('XDR-encoded unsigned Stellar transaction'),
    quoteId: z.string().describe('Hex-encoded SHA-256 quote identifier'),
  }),
);

const ApiErrorSchema = registry.register(
  'ApiError',
  z.object({
    code: z.string().describe('Machine-readable error code'),
    message: z.string().describe('Human-readable error description'),
  }),
);

const IntentRequestSchema = registry.register(
  'IntentRequest',
  z.object({
    type: z.literal('offramp'),
    sourceAsset: z.string().min(1),
    destinationAsset: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    sender: z.string().min(1).describe('Stellar public key of the sender'),
    recipient: z.string().min(1).describe('Destination address for the payout'),
  }),
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
