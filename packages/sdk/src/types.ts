/**
 * Wire types for the operations this SDK exposes.
 *
 * Hand-written, and kept honest by `tests/sdk-spec-sync.spec.ts`, which diffs
 * `OPERATIONS` below against `public/openapi.json`. See the README for why this
 * is not generated.
 */

export interface AnchorRate {
  anchorId: string;
  anchorName: string;
  corridorId: string;
  fee: string;
  feeType: string;
  exchangeRate: string;
  totalReceived: string;
  updatedAt: string;
  source: string;
  expiresAt?: string;
  quoteId?: string;
}

export interface RateComparison {
  corridorId: string;
  rates: AnchorRate[];
  /** True while at least one anchor is still being polled. */
  pending: boolean;
  /** `anchorId` of the best rate, or null when none resolved. */
  bestRateId: string | null;
  errors?: { anchorId: string; anchorName: string; reason: string }[];
}

export interface OfframpIntentRequest {
  type: 'offramp';
  sourceAsset: string;
  destinationAsset: string;
  amount: string;
  /** Stellar public key of the sender. */
  sender: string;
  /** Destination address for the payout. */
  recipient: string;
}

export interface OfframpRoute {
  anchorId: string;
  anchorDomain: string;
  corridorId: string;
  estimatedFee: string;
  estimatedReceived: string;
}

export interface OfframpIntentResponse {
  route: OfframpRoute;
  /** XDR-encoded unsigned Stellar transaction. */
  unsignedTx: string;
  /** Hex-encoded SHA-256 quote identifier. */
  quoteId: string;
}

export interface AnchorHealth {
  anchorId: string;
  status: 'ok' | 'fail' | 'unknown' | 'stale';
  consecutiveFailures: number;
  degraded: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  stale: boolean;
}

/**
 * Every endpoint this SDK calls, as `METHOD path`.
 *
 * The drift test asserts each of these exists in the committed OpenAPI spec, so
 * a route rename fails CI here rather than at a consumer's runtime.
 */
export const OPERATIONS = {
  getRates: 'GET /api/rates/{corridor}',
  submitOfframpIntent: 'POST /api/v1/intent/offramp',
  getAnchorHealth: 'GET /api/v1/anchors/{id}/health',
  getHealth: 'GET /api/v1/health',
  getVolumeSavings: 'GET /api/v1/corridors/{corridor}/volume-savings',
} as const;

export type OperationName = keyof typeof OPERATIONS;
