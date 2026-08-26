// ─── Anchors ─────────────────────────────────────────────────────────────────

/** Asset codes whose rate path is guarded by an opt-in deployment flag. */
export type FeatureGatedAnchorAssetCode = 'USDT';

/** A Stellar anchor that supports SEP-24 withdrawals and/or deposits. */
export interface Anchor {
  id: string;
  name: string;
  homeDomain: string;
  corridors: string[]; // corridor IDs this anchor serves
  /** Primary Stellar asset sold through this anchor's registered corridors. */
  assetCode: string;
  /** Issuer account for `assetCode`; used to build SEP-38 asset identifiers. */
  assetIssuer: string;
  /**
   * Optional service domain distinct from home domain.
   * When present, SEP endpoints are resolved from this domain instead of homeDomain.
   * Example: home domain "mgusd.moneygram.com" (issuer-only) vs service domain "stellar.moneygram.com" (SEP endpoints).
   */
  serviceDomain?: string;
  /** Known SEP protocol support flags for this anchor. */
  seps?: Array<'sep6' | 'sep10' | 'sep24' | 'sep31' | 'sep38'>;
  /** Structured operator-supplied metadata, as collected by the anchor onboarding template. */
  metadata?: AnchorMetadata;
}

/**
 * Structured metadata collected via `.github/ISSUE_TEMPLATE/anchor-onboard.yml`.
 * All fields optional — populated only once an anchor operator has supplied them.
 */
export interface AnchorMetadata {
  /** Sender vs. receiver region coverage; these are rarely identical. */
  regions?: {
    senders?: string;
    receivers?: string;
  };
  /** How the anchor performs KYC, per the onboarding template's dropdown options. */
  kycModel?: string;
  /** Free-text description of the anchor's fee/spread model. */
  feeModel?: string;
}

/** A payment corridor from one asset to a fiat currency in a given country. */
export interface Corridor {
  id: string; // e.g. 'usdc-ngn'
  from: string; // asset code, e.g. 'USDC'
  to: string; // fiat currency code, e.g. 'NGN'
  countryCode: string; // ISO 3166-1 alpha-2
  countryName: string;
}

// ─── Rate comparison ──────────────────────────────────────────────────────────

/** The fee structure an anchor charges for a given corridor and amount. */
export interface AnchorRate {
  anchorId: string;
  anchorName: string;
  corridorId: string;
  fee: number | null; // flat fee in the anchor's sold asset; null when unreachable
  feeType: 'flat' | 'percent' | 'combined';
  exchangeRate: number | null; // local currency units per sold asset; null when unreachable
  totalReceived: number | null; // computed: (amount - fee) * exchangeRate; null when anchor is unreachable
  updatedAt: Date;
  /**
   * Discriminates the origin of the rate data. `sep38` is the only firm,
   * binding quote source; every other source (besides `unavailable`) is an
   * estimate derived from published fee schedules and must never be
   * presented or scored as equivalent-confidence to a firm SEP-38 quote.
   * See `isIndicativeRateSource`.
   */
  source: 'sep38' | 'sep24-fee' | 'sep6-info' | 'sep6-fee' | 'unavailable';
  expiresAt?: Date | undefined;
  /**
   * SEP-38 firm quote id, when this rate originated from a quote server.
   * Two anchors that proxy the same liquidity pool can return the same id;
   * the rates engine dedupes on this field. Absent for non-SEP-38 sources.
   */
  quoteId?: string;
  /** Row-level quote lifecycle state. Only meaningful for source === 'sep38'. */
  quoteStatus?: 'firm' | 'expiring' | 'refreshing';
  /**
   * Composite reputation score for this anchor in the range [0, 1].
   * Derived from fill rate, slippage, and settlement latency.
   * Present when the leaderboard API is reachable; absent otherwise.
   */
  reputationScore?: number;
  /**
   * 1-based rank position in the reputation leaderboard (lower = better).
   * Present when the leaderboard API is reachable; absent otherwise.
   */
  reputationRank?: number;
}

/**
 * Rate sources that are estimates, not binding quotes. Modeled generally on
 * `AnchorRate.source` rather than special-cased per anchor id, so any anchor
 * whose only integration is SEP-6 (or the SEP-24 /fee fallback) is labeled
 * indicative — not only Cowrie, the first anchor this applied to.
 */
const INDICATIVE_RATE_SOURCES: ReadonlySet<AnchorRate['source']> = new Set([
  'sep24-fee',
  'sep6-info',
  'sep6-fee',
]);

/** True when a rate is an estimate rather than a firm SEP-38 quote. */
export function isIndicativeRateSource(source: AnchorRate['source']): boolean {
  return INDICATIVE_RATE_SOURCES.has(source);
}

export interface AnchorRateError {
  anchorId: string;
  anchorName: string;
  reason: string;
}

/** The result of comparing all anchor rates for a single corridor. */
export interface RateComparison {
  corridorId: string;
  rates: AnchorRate[];
  pending: { anchorId: string; anchorName: string }[]; // Anchors still resolving
  bestRateId: string; // anchorId of the anchor with the highest totalReceived

  errors?: AnchorRateError[];
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

/** The current state of the Freighter browser extension. */
export interface FreighterState {
  isInstalled: boolean;
  isConnected: boolean;
  publicKey: string | null;
  network: string | null;
  error: string | null;
}

// ─── SEP-1 ────────────────────────────────────────────────────────────────────

/** Per-anchor protocol capability flags derived from the resolved TOML. */
export interface AnchorCapabilities {
  sep10: boolean;
  sep24: boolean;
  sep38: boolean;
  sep12: boolean;
  sep6?: boolean;
  sep31?: boolean;
}

/** Relevant fields from a stellar.toml file resolved via SEP-1. */
export interface Sep1TomlData {
  domain: string;
  TRANSFER_SERVER_SEP0024: string | null;
  TRANSFER_SERVER?: string | null;
  DIRECT_PAYMENT_SERVER?: string | null;
  ANCHOR_QUOTE_SERVER: string | null;
  WEB_AUTH_ENDPOINT: string | null;
  SIGNING_KEY: string | null;
  NETWORK_PASSPHRASE: string | null;
  /** SEP-1 [DOCUMENTATION]: organization website (https). */
  ORG_URL: string | null;
  /** SEP-1 [DOCUMENTATION]: user support email. */
  ORG_SUPPORT_EMAIL: string | null;
  /** Optional non-standard support page URL some anchors publish. */
  ORG_SUPPORT_URL: string | null;
  CURRENCIES: Array<{ code: string; issuer?: string }>;
  capabilities: AnchorCapabilities;
  /** Normalized SEP capability flags for easy consumption by callers. */
  seps?: Array<'sep6' | 'sep10' | 'sep24' | 'sep31' | 'sep38'>;
}

/** A resolved anchor with protocol capabilities attached. */
export type ResolvedAnchor = Anchor & Sep1TomlData;

// ─── SEP-38 ───────────────────────────────────────────────────────────────────

/** A delivery method offered for buying or selling an off-chain SEP-38 asset. */
export interface Sep38DeliveryMethod {
  name: string;
  description: string;
}

/** A single asset entry from the SEP-38 GET /info response. */
export interface Sep38Asset {
  /** SEP-38 asset identifier, e.g. "stellar:USDC:GA5..." or "iso4217:BRL". */
  asset: string;
  /** Methods for selling (delivering) the asset to the anchor. Empty for on-chain assets. */
  sellDeliveryMethods: Sep38DeliveryMethod[];
  /** Methods for buying (receiving) the asset from the anchor. Empty for on-chain assets. */
  buyDeliveryMethods: Sep38DeliveryMethod[];
  /** ISO 3166-1 alpha-3 country codes the asset is available in. */
  countryCodes: string[];
}

/** Parsed SEP-38 GET /info response: supported assets and their delivery methods. */
export interface Sep38Info {
  assets: Sep38Asset[];
}

/** Request parameters for the SEP-38 GET /prices indicative price feed. */
export interface Sep38PricesParams {
  sell_asset: string;
  sell_amount: string;
  sell_delivery_method?: string;
  buy_delivery_method?: string;
  country_code?: string;
}

/** A single indicative buy option from the SEP-38 GET /prices response. */
export interface Sep38IndicativePrice {
  /** The SEP-38 identifier of the asset that can be bought (raw `asset` field). */
  asset: string;
  /** Alias of `asset`: the asset the user would buy with the sell asset. */
  buy_asset: string;
  /** Indicative unit price of buy_asset in terms of sell_asset, as a decimal string. */
  price: string;
  /** Indicative total price for the requested sell_amount, including fees. */
  total_price: string;
}

/** The downstream protocol a SEP-38 firm quote will be used with. */
export type Sep38QuoteContext = 'sep6' | 'sep24' | 'sep31';

/** Request parameters for SEP-38 POST /quote (firm quote creation). */
export interface Sep38QuoteParams {
  sell_asset: string;
  buy_asset: string;
  sell_amount: string;
  context: Sep38QuoteContext;
  buy_delivery_method?: string;
  sell_delivery_method?: string;
  country_code?: string;
  /** RFC 3339 timestamp; the quote must remain valid until at least this time. */
  expire_after?: string;
}

// ─── SEP-10 ───────────────────────────────────────────────────────────────────

/** A JWT issued by an anchor after successful SEP-10 authentication. */
export interface Sep10Auth {
  jwt: string;
  anchorDomain: string;
  publicKey: string;
  expiresAt: Date;
}

// ─── SEP-24 ───────────────────────────────────────────────────────────────────

/** Parameters for the SEP-24 GET /fee endpoint. */
export interface Sep24FeeParams {
  anchorDomain: string;
  operation: 'deposit' | 'withdraw';
  assetCode: string;
  assetIssuer: string;
  amount: string;
  type: 'bank_account' | 'cash' | 'mobile_money';
}

/** Body sent to POST /transactions/withdraw/interactive. */
export interface Sep24WithdrawRequest {
  assetCode: string;
  assetIssuer: string;
  amount: string;
  account: string; // user's Stellar public key
  jwt: string;
  /** SEP-38 firm quote id, when the anchor supports quote-bound withdrawals. */
  quoteId?: string;
}

/** Response from POST /transactions/withdraw/interactive. */
export interface Sep24WithdrawResponse {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

/** Body sent to POST /transactions/deposit/interactive. */
export interface Sep24DepositRequest {
  assetCode: string;
  assetIssuer: string;
  amount: string;
  account: string; // user's Stellar public key, credited on deposit completion
  jwt: string;
}

/** Response from POST /transactions/deposit/interactive. */
export interface Sep24DepositResponse {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

/** All possible raw status strings an anchor may return for a SEP-24 transaction. */
export type WithdrawStatusValue =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_user_transfer_complete'
  | 'pending_external'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_trust'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'error'
  | 'no_market'
  | 'too_small'
  | 'too_large'
  | 'expired';

/**
 * Canonical app-wide status enum.
 * Raw anchor strings (WithdrawStatusValue) are mapped to this via sep24-status-map.ts.
 */
export type WithdrawStatus =
  | 'pending_user_action'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'completed'
  | 'no_market'
  | 'refunded'
  | 'expired'
  | 'error';

/** Payment breakdown for a refunded SEP-24 transaction. */
export interface Sep24RefundPayment {
  id: string;
  id_type: string;
  amount: string;
  fee: string;
}

/** Refund details for a SEP-24 transaction. */
export interface Sep24Refunds {
  amount_refunded: string;
  amount_fee: string;
  payments: Sep24RefundPayment[];
}

/** The live record of a SEP-24 withdrawal transaction returned by the anchor. */
export interface Sep24Transaction {
  id: string;
  status: WithdrawStatusValue;
  amountIn?: string | undefined;
  amountInAsset?: string | undefined;
  amountOut?: string | undefined;
  amountOutAsset?: string | undefined;
  amountFee?: string | undefined;
  updatedAt: Date;
  stellarTransactionId?: string | undefined;
  externalTransactionId?: string | undefined;
  refunds?: Sep24Refunds | undefined;
}

// ─── Intent schema ────────────────────────────────────────────────────────────

/** Delivery method preference for fiat payout. */
export type DeliveryHint = 'bank_account' | 'cash' | 'mobile_money';

/** User preferences for routing and execution. */
export interface IntentPreferences {
  allowSplit?: boolean; // whether to allow multi-anchor splits
  maxAnchors?: number; // maximum number of anchors to use (default: 1 for MVP)
  preferAnchorIds?: string[]; // optional anchor whitelist
}

/** The user's signed statement of purpose for off-ramp withdrawal. */
export interface Intent {
  version: 1;
  nonce: string; // 128-bit random, replay protection
  account: string; // user's Stellar public key
  corridor: string; // e.g. 'usdc-ngn'
  sellAsset: { code: string; issuer: string }; // e.g. USDC
  sellAmount: string; // decimal string in send asset
  buyAsset: { code: string }; // fiat currency code, e.g. 'NGN'
  minReceive: string; // floor on delivered amount (decimal string)
  deliveryHint: DeliveryHint; // preferred delivery method
  deadline: string; // RFC3339, e.g. 2026-05-23T19:00:00Z
  preferences?: IntentPreferences;
}

/** A signed intent with hash and cryptographic signature. */
export interface SignedIntent {
  intent: Intent;
  intentHash: string; // sha-256 hex over canonical JSON
  signature: string; // ed25519 hex signature over intentHash
}

// ─── SEP-38 Quote ──────────────────────────────────────────────────────────────

/** A firm SEP-38 quote from an anchor. Maps to POST /sep38/quote response. */
export interface Sep38Quote {
  id: string; // Unique quote identifier
  price: string; // exchange rate: local currency units per 1 sell_asset
  total_price: string; // effective price after fees
  sell_amount: string; // exact amount in sell_asset (may differ from request)
  buy_amount: string; // exact amount in buy_asset
  fee: {
    total: string; // total fee in sell_asset
    percent?: string; // fee as percentage, when the anchor reports it
  };
  expires_at: string; // RFC3339 expiry timestamp
  context: Sep38QuoteContext; // context used in the quote request
}

/** An evaluated SEP-38 quote with eligibility and score information. */
export interface EvaluatedQuote extends Sep38Quote {
  anchorId: string;
  anchorName: string;
  meetsFloor: boolean; // whether buyAmount >= intent.minReceive
  expiredAt: Date; // parsed expires_at
  isExpired: boolean; // whether quote has expired
  netAmount: string; // buy amount (for clarity in solver output)
}

// ─── Router Plan ───────────────────────────────────────────────────────────────

/** A single-anchor execution plan: which anchor to use and the firm quote. */
export interface Plan {
  type: 'single_anchor';
  anchorId: string;
  anchorName: string;
  quoteId: string; // SEP-38 quote ID to pass to /transactions/withdraw/interactive
  netAmount: string; // amount user will receive in buy_asset
  fee: string; // fee amount in sell_asset
  price: string; // exchange rate used
}

/** Result of the solver: either a plan to execute or a typed error. */
export type SolverResult =
  | { ok: true; plan: Plan }
  | { ok: false; error: 'no_eligible_route' }
  | { ok: false; error: 'floor_not_met'; details: string }
  | { ok: false; error: 'all_quotes_expired'; details: string }
  | { ok: false; error: 'fee_budget_exceeded'; details: string };

// ─── Hop chain (H3 primitive II — chained atomic execution, #815) ─────────────
//
// A hop chain composes on-ramp, swap, and yield legs — the modules H2
// deliberately deferred (see ROADMAP.md) — into a single sequenced plan.
// "Atomic" here means every hop's preconditions are validated together
// before any hop executes (see planHopChain in lib/router/hops.ts), not a
// single ledger-level rollback: on-ramp/off-ramp legs are off-chain SEP
// flows that cannot share a Stellar transaction with on-chain swap/yield
// legs, so there is no ledger primitive that could make the whole chain
// roll back atomically. Execution still stops at the first failed hop so
// no downstream hop ever spends an output that was never produced.

/** The three module types a hop chain can sequence. */
export type HopType = 'on-ramp' | 'swap' | 'yield';

/** An amount of a specific asset flowing between hops. */
export interface HopAsset {
  /** `iso4217:CCY` for fiat, `stellar:CODE:ISSUER` (or `stellar:native`) for a Stellar asset. */
  asset: string;
  amount: string;
}

/** A single planned leg of a hop chain, produced by `Hop.plan`. */
export interface HopStep {
  hopType: HopType;
  /** Connector id, e.g. `moneygram-on-ramp`, `soroswap-swap`, `blend-yield`. */
  hopId: string;
  input: HopAsset;
  output: HopAsset;
  /** Connector-specific data needed to execute this step (quote id, pool id, XDR, etc). */
  details: Record<string, unknown>;
}

/** A composed, planned hop chain ready to execute. */
export interface HopChainPlan {
  type: 'hop_chain';
  steps: HopStep[];
  finalOutput: HopAsset;
}

export type HopPlanResult =
  | { ok: true; step: HopStep }
  | { ok: false; hopId: string; error: string; details?: string };

export type HopExecutionResult =
  | {
      ok: true;
      hopId: string;
      output: HopAsset;
      txRef?: string;
      /** Connector-specific artifacts, e.g. an unsigned XDR awaiting signature. */
      details?: Record<string, unknown>;
    }
  | { ok: false; hopId: string; error: string; details?: string };

/** Shared, read-only context threaded through every hop in a chain. */
export interface HopContext {
  now?: () => Date;
  [key: string]: unknown;
}

/**
 * A single leg a solver can chain: on-ramp, swap, or yield. `plan` must be
 * side-effect free (simulate only); `execute` is only ever called with a
 * step that this same hop already planned successfully.
 */
export interface Hop {
  readonly type: HopType;
  readonly id: string;
  plan(input: HopAsset, context: HopContext): Promise<HopPlanResult>;
  execute(step: HopStep, context: HopContext): Promise<HopExecutionResult>;
}

export type HopChainPlanResult =
  | { ok: true; plan: HopChainPlan }
  | {
      ok: false;
      failedHopId: string;
      error: string;
      details?: string;
      /** Steps that planned successfully before the failure, for diagnostics. */
      completedSteps: HopStep[];
    };

export interface HopChainExecutionResult {
  ok: boolean;
  /** Results in the order attempted; stops at the first failure. */
  completed: HopExecutionResult[];
  failedAt?: string;
  /**
   * User-facing summary of what happened, present whenever `ok` is false
   * (#1090). States what completed (with any reference the user needs),
   * what failed and why, and what the user should do next — never a bare
   * error code, since a mid-route failure can mean real money already moved.
   */
  message?: string;
}

/** One leg of a multi-anchor split — the tranche of the order routed to a single anchor. */
export interface PlanLeg {
  anchorId: string;
  anchorName: string;
  quoteId: string; // SEP-38 quote id backing this leg
  sellAmount: string; // tranche routed to this anchor (sell asset)
  netAmount: string; // delivered by this leg (buy asset)
  fee: string; // fee for this leg (sell asset)
  price: string; // exchange rate used for this leg
}

/**
 * A multi-anchor execution plan: the order is split across ranked anchors and
 * executed as a single atomic multi-op Stellar transaction (all legs settle or
 * none do). Legs are ordered best-price first.
 */
export interface MultiAnchorPlan {
  type: 'multi_anchor';
  legs: PlanLeg[];
  totalSell: string; // sum of leg sellAmounts (equals the requested order size when fully filled)
  netAmount: string; // sum of leg netAmounts (aggregate delivered)
}

/** Either a single-anchor plan or a multi-anchor split. */
export type ExecutionPlan = Plan | MultiAnchorPlan;

/** Result of the multi-anchor solver: a split plan to execute or a typed error. */
export type MultiSolverResult =
  | { ok: true; plan: MultiAnchorPlan }
  | { ok: false; error: 'no_eligible_route' }
  | { ok: false; error: 'floor_not_met'; details: string }
  | { ok: false; error: 'all_quotes_expired'; details: string }
  | { ok: false; error: 'insufficient_liquidity'; details: string };

// ─── API ──────────────────────────────────────────────────────────────────────

/** Shape returned by API routes on error. */
export interface ApiError {
  code: string;
  message: string;
  anchorId?: string;
  /** Seconds until the client may retry. Only meaningful for code === 'RATE_LIMITED'. */
  retryAfter?: number;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

/** A country supported by the off-ramp module. */
export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: string; // ISO 4217
  currencySymbol: string;
  flag: string;
}

export type RiskLevel = 'low' | 'medium' | 'high';

// ─── ExecuteDrawer state machine ─────────────────────────────────────────────

/** Steps in the ExecuteDrawer off-ramp flow state machine. */
export type ExecuteDrawerStep =
  | 'idle'
  | 'authenticating'
  | 'quoting'
  | 'initiating'
  | 'kyc'
  | 'form'
  | 'building'
  | 'signing'
  | 'done'
  | 'error';

// ─── Stellar assets (used by Horizon swap routing) ────────────────────────────

export interface StellarAsset {
  code: string;
  issuer?: string;
  name: string;
  logoUrl?: string;
}

export interface SwapRoute {
  routeId: string;
  source: 'SDEX' | 'Soroswap' | 'Phoenix' | 'Aquarius';
  fromAsset: StellarAsset;
  toAsset: StellarAsset;
  fromAmount: number;
  toAmount: number;
  price: number;
  priceImpact: number;
  fee: number;
  path: StellarAsset[];
  estimatedTime: string;
  lastUpdated: Date;
}

// ─── KYC iframe ────────────────────────────────────────────────────────────────

/** PostMessage data structure for KYC iframe communication */
export interface KycPostMessage {
  type: 'stellar_transaction_created' | 'stellar_cancel';
  transaction_id?: string;
}

// ─── SEP-6 ────────────────────────────────────────────────────────────────────

/** Parameters for the SEP-6 GET /withdraw request. */
export interface Sep6WithdrawParams {
  asset_code: string;
  type: string;
  dest: string;
  amount?: string;
  account?: string;
}

/** SEP-6 /withdraw interactive response. */
export interface Sep6WithdrawInteractive {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

/** SEP-6 /withdraw non-interactive response. */
export interface Sep6WithdrawNonInteractive {
  type: 'non_interactive';
  id: string;
  eta?: number;
  min_amount?: number;
  max_amount?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  extra_info?: { message?: string };
}

/** SEP-6 /withdraw needs_info response. */
export interface Sep6WithdrawNeedsInfo {
  type: 'customer_info_status';
  fields: Record<string, { description: string; choices?: string[]; optional?: boolean }>;
}

/** Union of all three SEP-6 /withdraw response shapes. */
export type Sep6WithdrawResponse =
  | Sep6WithdrawInteractive
  | Sep6WithdrawNonInteractive
  | Sep6WithdrawNeedsInfo;

// ─── SEP-12 ───────────────────────────────────────────────────────────────────

/** Normalized customer status returned by SEP-12 GET /customer. */
export type CustomerStatus = 'ACCEPTED' | 'NEEDS_INFO' | 'PROCESSING' | 'REJECTED';

export interface Sep12CustomerField {
  description?: string;
  type?: string;
  error?: string;
  status?: string;
}

export interface Sep12CustomerResponse {
  id?: string;
  status: CustomerStatus;
  fields?: Record<string, Sep12CustomerField>;
  provided_fields?: Record<string, Sep12CustomerField>;
  message?: string;
}
