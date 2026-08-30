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

export interface CorridorVolumeSavings {
  corridorId: string;
  /** Cumulative volume routed through the corridor, in microUSDC. */
  volumeUsdc: number;
  /** Cumulative saved against the baseline rate, in microUSDC. */
  savingsUsdc: number;
  /** Settlements behind both totals. */
  settlementCount: number;
  /** Ledger timestamp of the last on-chain update; 0 when never written. */
  updatedAt: number;
}

/** One anchor's row in the nightly health ledger. */
export interface AnchorHealthLedgerEntry {
  consecutiveFailures: number;
  degraded: boolean;
  lastCheckedAt: string | null;
  lastStatus: string;
  lastError: string | null;
}

/**
 * The nightly anchor health ledger for one date, as published by
 * `GET /api/v1/anchor-health/ledger`.
 */
export interface AnchorHealthLedgerArtifact {
  /** The `YYYY-MM-DD` this ledger describes. Same version means same ledger. */
  version: string;
  /** The date that was asked for, or null when the latest was asked for. */
  requestedDate: string | null;
  /** `committed` is the file the deployment was built with; `git-history` is a past revision of it. */
  source: 'committed' | 'git-history';
  /** Commit the ledger was read from; null for the committed file. */
  commit: string | null;
  ledger: {
    thresholdNights: number;
    updatedAt: string | null;
    anchors: Record<string, AnchorHealthLedgerEntry>;
  };
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
  getAnchorHealthLedger: 'GET /api/v1/anchor-health/ledger',
  getCorridorVolumeSavings: 'GET /api/v1/corridors/{corridor}/volume-savings',
  getHealth: 'GET /api/v1/health',
} as const;

export type OperationName = keyof typeof OPERATIONS;
