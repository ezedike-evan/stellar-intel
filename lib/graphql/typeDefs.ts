/**
 * SDL for the additive GraphQL surface. REST v1 (documented in
 * public/openapi.json) stays canonical — this schema covers the same four
 * resources (anchors, health, rates, intents) as a convenience surface for
 * clients that want a single round trip, and resolves through the exact
 * same lib/ data-access functions REST uses (see lib/graphql/resolvers.ts).
 */
export const typeDefs = /* GraphQL */ `
  type Query {
    "A single anchor by id. Returns null if the id is unknown."
    anchor(id: ID!): Anchor
    "Anchors serving a corridor, or every known anchor when corridorId is omitted."
    anchors(corridorId: ID): [Anchor!]!
    "Live rate comparison for a corridor, resolved through the same cache REST's GET /api/rates/[corridor] uses."
    rates(corridor: ID!, amount: String, forceRefresh: Boolean): RateComparison!
    "Aggregate system health: degraded anchors, publisher liveness, rolling rate-cache counters."
    health: HealthStatus!
  }

  type Mutation {
    "Resolves an off-ramp intent to a route and an unsigned Stellar transaction, identical to POST /api/intent/offramp."
    submitOfframpIntent(input: OfframpIntentInput!): OfframpIntentResult!
  }

  type Anchor {
    id: ID!
    name: String!
    homeDomain: String!
    corridors: [String!]!
    assetCode: String!
    assetIssuer: String!
    seps: [String!]
    "True when the nightly validator has auto-flagged this anchor unhealthy."
    degraded: Boolean!
  }

  type AnchorRate {
    anchorId: ID!
    anchorName: String!
    corridorId: ID!
    fee: Float
    feeType: String!
    exchangeRate: Float
    totalReceived: Float
    updatedAt: String!
    source: String!
    expiresAt: String
    quoteId: String
    quoteStatus: String
  }

  type AnchorRateError {
    anchorId: ID!
    anchorName: String!
    reason: String!
  }

  type RateComparison {
    corridorId: ID!
    rates: [AnchorRate!]!
    bestRateId: String!
    errors: [AnchorRateError!]
  }

  type AnchorHealthStatus {
    anchorId: ID!
    degraded: Boolean!
    lastCheckedAt: String
    lastStatus: String
  }

  type PublisherHealth {
    lastRun: String
    lastBatchSize: Int
    lastError: String
    staleSinceMs: Int
  }

  type RatesCacheHealth {
    hits: Int!
    misses: Int!
  }

  type HealthStatus {
    degradedAnchors: [AnchorHealthStatus!]!
    publisher: PublisherHealth!
    ratesCache: RatesCacheHealth!
  }

  input OfframpIntentInput {
    sourceAsset: String!
    destinationAsset: String!
    amount: String!
    sender: String!
    recipient: String!
  }

  type OfframpRoute {
    anchorId: ID!
    anchorDomain: String!
    corridorId: ID!
    estimatedFee: String!
    estimatedReceived: String!
  }

  type OfframpIntentResult {
    route: OfframpRoute!
    unsignedTx: String!
    quoteId: String!
  }
`;
