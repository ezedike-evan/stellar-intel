import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { STELLAR_PUBKEY_PATTERN, AMOUNT_PATTERN, AMOUNT_7DP_PATTERN } from '@/lib/patterns';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ─── Reusable param helpers ─────────────────────────────────────────────────

const CorridorPathParam = z.string().openapi({
  param: { name: 'corridor', in: 'path' },
  example: 'usdc-ngn',
  description: 'Corridor ID (e.g. usdc-ngn, usdc-kes)',
});

const AnchorPathParam = z.string().openapi({
  param: { name: 'anchor', in: 'path' },
  example: 'cowrie',
  description: 'Anchor ID from the registry',
});

const AmountQueryParam = z
  .string()
  .optional()
  .openapi({
    param: { name: 'amount', in: 'query' },
    example: '100',
    description: 'Amount to convert (positive decimal)',
  });

const CorridorQueryParam = z
  .string()
  .optional()
  .openapi({
    param: { name: 'corridor', in: 'query' },
    example: 'usdc-ngn',
    description: 'Filter by corridor ID',
  });

const WindowQueryParam = z
  .string()
  .optional()
  .openapi({
    param: { name: 'window', in: 'query' },
    example: '30d',
    description: 'Time window (7d, 30d, 90d)',
  });

// ─── Schemas ─────────────────────────────────────────────────────────────────

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
    retryAfter: z
      .number()
      .optional()
      .describe('Seconds until the client may retry. Only present for code === "RATE_LIMITED"'),
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
      .describe(
        'Current health status: ok, fail, unknown (never checked), or stale (last check >24h ago)'
      ),
    consecutiveFailures: z.number().describe('Consecutive nightly validation failures'),
    degraded: z
      .boolean()
      .describe('True when anchor is auto-flagged degraded after repeated failures'),
    lastCheckedAt: z
      .string()
      .nullable()
      .describe('ISO timestamp of the last nightly check, or null if never checked'),
    lastError: z
      .string()
      .nullable()
      .describe('Failure reason from the last check, or null on success'),
    stale: z.boolean().describe('True when the last probe is older than 24 hours'),
  })
);

// Suppress unused-variable warnings — schemas are referenced only via the registry
void SignedIntentEnvelopeSchema;

const AnchorRateSchema = registry.register(
  'AnchorRate',
  z.object({
    anchorId: z.string(),
    anchorName: z.string(),
    corridorId: z.string(),
    fee: z.string(),
    feeType: z.string(),
    exchangeRate: z.string(),
    totalReceived: z.string(),
    updatedAt: z.string(),
    source: z.string(),
    expiresAt: z.string().optional(),
    quoteId: z.string().optional(),
  })
);

const RateComparisonSchema = registry.register(
  'RateComparison',
  z.object({
    corridorId: z.string(),
    rates: z.array(AnchorRateSchema),
    pending: z.boolean(),
    bestRateId: z.string().nullable(),
    errors: z
      .array(z.object({ anchorId: z.string(), anchorName: z.string(), reason: z.string() }))
      .optional(),
  })
);

const DisputeRecordSchema = registry.register(
  'DisputeRecord',
  z.object({
    id: z.string(),
    intentHash: z.string(),
    publicKey: z.string(),
    anchorId: z.string(),
    reason: z.string(),
    disputed: z.boolean(),
    createdAt: z.string(),
  })
);

const DisputeAdminSchema = registry.register(
  'DisputeAdmin',
  z.object({
    id: z.string(),
    submittedBy: z.string(),
    anchorId: z.string(),
    reason: z.string(),
    status: z.enum(['pending', 'accepted', 'rejected']),
    createdAt: z.string(),
    resolvedAt: z.string().nullable(),
  })
);

const LeaderboardEntrySchema = registry.register(
  'LeaderboardEntry',
  z.object({
    anchor_id: z.string(),
    composite: z.number(),
    fill_rate: z.number(),
    settle_p50: z.number(),
    slippage_p50: z.number(),
    n: z.number(),
    onChain: z.any().nullable(),
  })
);

const LeaderboardResponseSchema = registry.register(
  'LeaderboardResponse',
  z.object({
    leaderboard: z.array(LeaderboardEntrySchema),
    corridor: z.string().nullable(),
    generatedAt: z.string(),
  })
);

const PublisherHealthSchema = registry.register(
  'PublisherHealth',
  z.object({
    lastRun: z.string().nullable(),
    lastBatchSize: z.number().nullable(),
    lastError: z.string().nullable(),
    staleSinceMs: z.number().nullable(),
  })
);

const MetricsSnapshotSchema = registry.register(
  'MetricsSnapshot',
  z.object({
    intents: z.object({
      success: z.number(),
      errorTotal: z.number(),
      errors: z.record(z.string(), z.number()),
    }),
    anchorLatency: z.record(
      z.string(),
      z.object({
        p50Ms: z.number(),
        p95Ms: z.number(),
        sampleCount: z.number(),
      })
    ),
    ratesCache: z.object({ hits: z.number(), misses: z.number() }),
    publisherHealth: PublisherHealthSchema,
  })
);

// Suppress unused-variable warnings
void SignedIntentEnvelopeSchema;
void AnchorRateSchema;
void DisputeRecordSchema;
void DisputeAdminSchema;
void LeaderboardResponseSchema;
void PublisherHealthSchema;
void MetricsSnapshotSchema;

// ─── Route registrations ─────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/rates/{corridor}',
  summary: 'Get live rates for a corridor',
  description:
    'Returns live SEP-38 firm quotes (with SEP-24/SEP-6 fallback) for every integrated anchor serving the given corridor. Results are cached for 15 seconds.',
  tags: ['Rates'],
  request: {
    params: z.object({ corridor: CorridorPathParam }),
    query: z.object({
      amount: AmountQueryParam,
      forceRefresh: z
        .string()
        .optional()
        .openapi({ param: { name: 'forceRefresh', in: 'query' }, description: 'Bypass cache' }),
    }),
  },
  responses: {
    200: {
      description: 'Rate comparison for the corridor',
      content: { 'application/json': { schema: RateComparisonSchema } },
    },
    400: {
      description: 'Unknown corridor or invalid amount',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/intent/offramp',
  summary: 'Submit an off-ramp intent',
  description:
    'Resolves an anchor route for the given asset corridor, builds an unsigned Stellar payment transaction, and returns a quote ID. ' +
    'Every response carries an `API-Version` header and `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. ' +
    'Send an `Idempotency-Key` header to safely retry: a repeated key within 24h replays the original response ' +
    '(flagged with `Idempotency-Replayed: true`) instead of re-executing the request. Only 200 and 400 responses are cached under a key; ' +
    'a 500 is never cached, so a retry with the same key will try again.',
  tags: ['Intent'],
  request: {
    headers: z.object({
      'Idempotency-Key': z
        .string()
        .optional()
        .describe(
          'Client-generated key. A repeated value within 24h replays the original response.'
        ),
    }),
    body: {
      required: true,
      content: { 'application/json': { schema: IntentRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'Route resolved and unsigned transaction built',
      content: { 'application/json': { schema: OfframpIntentResponseSchema } },
    },
    400: {
      description: 'Validation error or no route found',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    429: {
      description: 'Rate limited',
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

registry.registerPath({
  method: 'get',
  path: '/api/reputation/{anchor}',
  summary: 'Get anchor reputation',
  description:
    'Returns reputation data for a specific anchor. When a corridor query param is provided, returns per-corridor aggregates for 7/30/90-day windows. Without it, returns scorecards.',
  tags: ['Reputation'],
  request: {
    params: z.object({ anchor: AnchorPathParam }),
    query: z.object({
      corridor: CorridorQueryParam,
    }),
  },
  responses: {
    200: {
      description: 'Anchor reputation data',
      content: {
        'application/json': {
          schema: z.object({
            anchorId: z.string(),
            scorecards: z.any().optional(),
            windows: z.any().optional(),
            corridor: z.string().optional(),
            fetchedAt: z.string().optional(),
          }),
        },
      },
    },
    400: {
      description: 'Missing anchor param',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reputation/{anchor}/history',
  summary: 'Get anchor history',
  description:
    'Returns bucketed outcome history for a specific anchor over a configurable time window.',
  tags: ['Reputation'],
  request: {
    params: z.object({ anchor: AnchorPathParam }),
    query: z.object({ window: WindowQueryParam }),
  },
  responses: {
    200: {
      description: 'Bucketed history data',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    404: {
      description: 'Unknown anchor',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reputation/leaderboard',
  summary: 'Get reputation leaderboard',
  description:
    'Returns a ranked list of all anchors by composite reputation score. Optionally filter by corridor.',
  tags: ['Reputation'],
  request: {
    query: z.object({ corridor: CorridorQueryParam }),
  },
  responses: {
    200: {
      description: 'Leaderboard response',
      content: { 'application/json': { schema: LeaderboardResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/reputation/append',
  summary: 'Append outcome log row',
  description: 'The single server-side write path for reputation outcome rows.',
  tags: ['Reputation'],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            intentHash: z.string(),
            anchorId: z.string(),
            corridor: z.string(),
            outcome: z.enum(['completed', 'partial', 'refunded', 'expired', 'error']),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Outcome appended',
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean(), intentHash: z.string() }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/reputation/dispute',
  summary: 'Submit a reputation dispute',
  description:
    'Submits a dispute against an intent outcome. The request must be Ed25519-signed by the original sender.',
  tags: ['Reputation'],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            intentHash: z.string(),
            publicKey: z.string(),
            signature: z.string(),
            anchorId: z.string(),
            reason: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Dispute created',
      content: { 'application/json': { schema: DisputeRecordSchema } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    403: {
      description: 'Signature verification failed',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    429: {
      description: 'Rate limited (10/24h)',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/sep6/withdraw',
  summary: 'SEP-6 withdraw proxy',
  description:
    'Proxies a SEP-6 withdrawal request to the specified anchor transfer server. Runs server-side to avoid CORS issues.',
  tags: ['SEP-6'],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            transferServer: z.string().url(),
            assetCode: z.string(),
            account: z.string(),
            amount: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Anchor withdraw response (passthrough)',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/snapshot',
  summary: 'Get best-anchor snapshot',
  description:
    'Returns the best anchor per corridor for a given USDC amount. Used for the landing page teaser. Cached for 10 minutes.',
  tags: ['Rates'],
  request: {
    query: z.object({ amount: AmountQueryParam }),
  },
  responses: {
    200: {
      description: 'Best anchor snapshot',
      content: {
        'application/json': {
          schema: z.object({
            baseAmount: z.string(),
            corridors: z.array(z.object({ corridorId: z.string(), best: z.any().nullable() })),
          }),
        },
      },
    },
    400: {
      description: 'Invalid amount',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/metrics',
  summary: 'Get metrics snapshot',
  description:
    'Returns the in-process metrics snapshot including intent counters, anchor latency, and publisher health.',
  tags: ['System'],
  responses: {
    200: {
      description: 'Metrics snapshot',
      content: { 'application/json': { schema: MetricsSnapshotSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/publisher/health',
  summary: 'Get publisher health',
  description:
    'Returns the current publisher health status including last run time, batch size, and staleness.',
  tags: ['System'],
  responses: {
    200: {
      description: 'Publisher health status',
      content: { 'application/json': { schema: PublisherHealthSchema } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/publisher/tick',
  summary: 'Trigger publisher tick',
  description:
    'Triggers a batch of reputation outcome submissions to the Soroban oracle contract. Protected by CRON_SECRET.',
  tags: ['System'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Tick completed',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            submitted: z.number(),
            skipped: z.number(),
            txHash: z.string().nullable(),
            tickedAt: z.string(),
          }),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    409: {
      description: 'Tick already in progress',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/mcp/ping',
  summary: 'MCP health check',
  description: 'Simple health check / liveness probe for the MCP integration.',
  tags: ['System'],
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/disputes',
  summary: 'List disputes (admin)',
  description: 'Lists all disputes. Requires admin authentication.',
  tags: ['Admin'],
  security: [{ adminKey: [] }],
  responses: {
    200: {
      description: 'List of disputes',
      content: {
        'application/json': {
          schema: z.array(DisputeAdminSchema),
        },
      },
    },
    401: {
      description: 'Admin access required',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/disputes',
  summary: 'Resolve a dispute (admin)',
  description: 'Accepts or rejects a dispute. Requires admin authentication.',
  tags: ['Admin'],
  security: [{ adminKey: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            action: z.enum(['accept', 'reject']),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated dispute',
      content: { 'application/json': { schema: DisputeAdminSchema } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    401: {
      description: 'Admin access required',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    404: {
      description: 'Dispute not found',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/public/scores',
  summary: 'Get public scores',
  description:
    'Returns public 30-day corridor reputation scores. Supports conditional GET with ETags.',
  tags: ['Reputation'],
  responses: {
    200: {
      description: 'Public scores array',
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              anchorId: z.string(),
              corridor: z.string(),
              score30d: z.any(),
            })
          ),
        },
      },
    },
    304: {
      description: 'Not modified',
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

// ─── Previously undocumented routes (#918) ───────────────────────────────────
//
// Thirteen of twenty-nine route files were absent from this registry while the
// description above claimed the hardening contract applied to "every response".
// A generated SDK built from the old spec would have covered just over half the
// API.

const RATE_LIMITED_429 = {
  description: 'Rate limited',
  content: { 'application/json': { schema: ApiErrorSchema } },
} as const;

const UNAUTHORIZED_401 = {
  description: 'Missing or invalid credentials',
  content: { 'application/json': { schema: ApiErrorSchema } },
} as const;

registry.registerPath({
  method: 'post',
  path: '/api/graphql',
  summary: 'GraphQL endpoint',
  description:
    'Additive GraphQL surface over the same data the REST API serves (see docs/GRAPHQL_API.md). ' +
    'REST remains the source of truth documented here; the GraphQL schema is published separately.',
  tags: ['System'],
  responses: {
    200: {
      description: 'GraphQL result envelope',
      content: {
        'application/json': {
          schema: z.object({ data: z.any().optional(), errors: z.any().optional() }),
        },
      },
    },
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/intent',
  summary: 'Submit an intent (unversioned)',
  description:
    'Internal, unversioned intent endpoint. Prefer `POST /api/v1/intent/offramp`, which carries the ' +
    'v1 hardening contract and idempotency guarantees.',
  tags: ['Intent'],
  responses: {
    200: {
      description: 'Intent accepted',
      content: { 'application/json': { schema: OfframpIntentResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/intent/offramp',
  summary: 'Submit an off-ramp intent (v1)',
  description:
    'The public v1 intent endpoint. Honours `Idempotency-Key`: a retried request replays the ' +
    'original response with `Idempotency-Replayed: true` rather than creating a second intent.',
  tags: ['Intent'],
  responses: {
    200: {
      description: 'Intent accepted',
      content: { 'application/json': { schema: OfframpIntentResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  summary: 'Service health (v1)',
  description: 'Liveness and dependency status for the public v1 surface.',
  tags: ['System'],
  responses: {
    200: {
      description: 'Health snapshot',
      content: { 'application/json': { schema: z.object({ status: z.string() }).passthrough() } },
    },
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reputation/actuarial',
  summary: 'Actuarial progress report',
  description:
    'Progress toward statistically meaningful anchor scoring, combining settled outcomes with probe observations.',
  tags: ['Reputation'],
  responses: {
    200: {
      description: 'Actuarial progress report',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reputation/probe-coverage',
  summary: 'Probe coverage report',
  description:
    'How much probe history has accumulated per anchor, and how that compares with the 90-day ' +
    'mainnet-readiness window.',
  tags: ['Reputation'],
  responses: {
    200: {
      description: 'Probe coverage report',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reputation/sdf-export',
  summary: 'Anchor health export for the SDF Anchor Directory',
  description: 'Anchor health data in the shape SDF’s Anchor Directory consumes.',
  tags: ['Reputation'],
  responses: {
    200: {
      description: 'Export payload',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/reputation/refresh',
  summary: 'Run the probe sweep',
  description:
    'Cron-triggered. Probes every registered anchor across all four dimensions and persists the ' +
    'samples. Returns 500 when a sweep probes anchors but persists nothing. Protected by CRON_SECRET.',
  tags: ['System'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Sweep completed',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            refreshedAt: z.string(),
            probed: z.object({}).passthrough(),
          }),
        },
      },
    },
    401: UNAUTHORIZED_401,
    409: { description: 'A refresh is already in progress' },
    500: {
      description: 'Sweep persisted no samples',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reputation/reconcile',
  summary: 'Reconcile settled outcomes against Horizon',
  description: 'Cron-triggered reconciliation of pending outcome rows. Protected by CRON_SECRET.',
  tags: ['System'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Reconciliation completed',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    401: UNAUTHORIZED_401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/cache/invalidate',
  summary: 'Invalidate cached rates',
  description: 'Drops cached rate comparisons for one anchor or all of them. Admin only.',
  tags: ['System'],
  responses: {
    200: {
      description: 'Cache invalidated',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    401: UNAUTHORIZED_401,
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/webhooks/subscriptions',
  summary: 'List webhook subscriptions',
  description: 'Admin only. See docs/WEBHOOKS.md for the delivery and signing contract.',
  tags: ['System'],
  responses: {
    200: {
      description: 'Subscriptions',
      content: { 'application/json': { schema: z.array(z.object({}).passthrough()) } },
    },
    401: UNAUTHORIZED_401,
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/subscriptions',
  summary: 'Create a webhook subscription',
  description:
    'Admin only. Returns the per-subscription HMAC signing secret once, at creation time.',
  tags: ['System'],
  responses: {
    201: {
      description: 'Subscription created',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    401: UNAUTHORIZED_401,
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/webhooks/subscriptions/{id}',
  summary: 'Delete a webhook subscription',
  description: 'Admin only.',
  tags: ['System'],
  responses: {
    204: { description: 'Deleted' },
    401: UNAUTHORIZED_401,
    404: {
      description: 'Unknown subscription',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
    429: RATE_LIMITED_429,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/webhooks/failures',
  summary: 'List dead-lettered webhook deliveries',
  description:
    'Admin only. Deliveries that exhausted their retries and were dead-lettered (see docs/WEBHOOKS.md).',
  tags: ['System'],
  responses: {
    200: {
      description: 'Dead-lettered deliveries',
      content: { 'application/json': { schema: z.array(z.object({}).passthrough()) } },
    },
    401: UNAUTHORIZED_401,
    429: RATE_LIMITED_429,
  },
});

// ─── Spec builder ────────────────────────────────────────────────────────────

export function buildOpenApiSpec() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Stellar Intel API',
      // Keep in sync with API_VERSION in lib/api/response.ts.
      version: '1.3.0',
      description: [
        'Intent router and anchor rate aggregation API for the Stellar Intel platform.',
        '',
        '## Public v1 surface',
        '',
        'The stable, supported surface is namespaced under `/api/v1/...`; unversioned',
        'routes are internal and may change without notice. Every v1 response follows',
        'the hardening contract (see `lib/api/v1.ts`):',
        '',
        '- **Error envelope** — errors return `{ "error": { "code", "message", "requestId" } }`.',
        '- **Rate-limit headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`,',
        '  `X-RateLimit-Reset` on every response; `Retry-After` on a `429`.',
        '- **Idempotency** — send an `Idempotency-Key` header on mutating endpoints',
        '  (e.g. `POST /api/v1/intent/offramp`); a retried request replays the original',
        '  response (`Idempotency-Replayed: true`) instead of creating a second intent.',
      ].join('\n'),
      contact: {
        name: 'Stellar Intel',
        url: 'https://github.com/ezedike-evan/stellar-intel',
      },
    },
    servers: [
      { url: 'https://stellar-intel.vercel.app/api/v1', description: 'Production (public v1)' },
      {
        url: 'https://stellar-intel.vercel.app',
        description: 'Production (internal, unversioned)',
      },
      { url: 'http://localhost:3000', description: 'Development' },
    ],
  });
}
