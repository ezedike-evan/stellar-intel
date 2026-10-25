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

export type OnrampFundingType = 'bank_account' | 'cash' | 'mobile_money';

export interface OnrampQuoteRate {
  anchorId: string;
  anchorName: string;
  corridorId: string;
  /** SEP-38 identifier of the credited asset. */
  asset: string;
  fiatAmount: number;
  fee: number | null;
  feeType: 'flat' | 'percent' | 'combined';
  exchangeRate: number | null;
  totalReceived: number | null;
  /** Asset units the fiat buys before fees; the figure minAmount/maxAmount apply to. */
  assetAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  source: 'sep38' | 'sep24-fee' | 'unavailable';
  /** ISO 8601. */
  updatedAt: string;
}

/** Indicative deposit estimates per anchor. Never a firm quote. */
export interface OnrampQuote {
  corridorId: string;
  direction: 'deposit';
  rates: OnrampQuoteRate[];
  bestRateId: string;
  errors: { anchorId: string; anchorName: string; reason: string }[];
  indicative: true;
  disclaimer: string;
}

export interface OnrampIntentRequest {
  type: 'onramp';
  /** Fiat currency paid in, e.g. NGN. */
  sourceAsset: string;
  /** Stellar asset bought, e.g. USDC. */
  destinationAsset: string;
  amount: string;
  /** Payer reference on the fiat rail (not a Stellar account). */
  sender: string;
  /** Stellar public key credited when the deposit completes. */
  destination: string;
  depositMethod: 'bank_transfer' | 'cash' | 'mobile_money' | 'card';
  memo?: string;
  memoType?: 'text' | 'id' | 'hash';
}

export interface OnrampIntentResponse {
  route: {
    anchorId: string;
    anchorDomain: string;
    corridorId: string;
    asset: string;
    estimatedFee: string;
    estimatedReceived: string;
    indicative: true;
  };
  /** Hex-encoded SHA-256 of the canonical intent. */
  intentHash: string;
  /** Relative path into /onramp, where the interactive deposit runs in a browser. */
  handoffUrl: string;
  /** Base64 changeTrust transaction to sign, or null when a trustline already exists. */
  unsignedChangeTrustXdr: string | null;
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

/** One recorded SEP-38 indicative price. Amounts are decimal strings. */
export interface AnchorPricePoint {
  observedAt: string;
  price: string;
  totalPrice: string;
  source: string;
}

export interface AnchorPriceHistory {
  anchorId: string;
  corridor: string;
  /** Oldest first, at most 500 points. */
  points: AnchorPricePoint[];
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

/** One row of the anchor census, as published by `GET /api/v1/anchors/census`. */
export interface AnchorCensusRow {
  domain: string;
  tier: 'routable' | 'health-only' | 'listed';
  seps: {
    sep6: boolean;
    sep24: boolean;
    sep31: boolean;
    sep38: boolean;
    sep10: boolean;
  };
  withdrawAssets: string[];
  depositAssets: string[];
  receiveAssets: string[];
  sources: string[];
  registeredAnchorId: string | null;
  checkedAt: string;
}

/** Every surveyed anchor, optionally filtered to one tier. */
export interface AnchorCensusResponse {
  generatedAt: string | null;
  counts: {
    routable: number;
    healthOnly: number;
    listed: number;
    excluded: number;
  };
  rows: AnchorCensusRow[];
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
  submitOnrampIntent: 'POST /api/v1/intent/onramp',
  getOnrampQuote: 'GET /api/v1/onramp/quote',
  getAnchorHealth: 'GET /api/v1/anchors/{id}/health',
  getAnchorHealthLedger: 'GET /api/v1/anchor-health/ledger',
  getAnchorPriceHistory: 'GET /api/v1/anchors/{id}/price-history',
  getAnchorCensus: 'GET /api/v1/anchors/census',
  getCorridorVolumeSavings: 'GET /api/v1/corridors/{corridor}/volume-savings',
  getHealth: 'GET /api/v1/health',
  getVolumeSavings: 'GET /api/v1/corridors/{corridor}/volume-savings',
} as const;

export type OperationName = keyof typeof OPERATIONS;
