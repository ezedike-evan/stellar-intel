// ─── Anchors ─────────────────────────────────────────────────────────────────

/** A Stellar anchor that supports SEP-24 withdrawals and/or deposits. */
export interface Anchor {
  id: string
  name: string
  homeDomain: string
  corridors: string[] // corridor IDs this anchor serves
  assetCode: string
  assetIssuer: string
}

/** A payment corridor from one asset to a fiat currency in a given country. */
export interface Corridor {
  id: string // e.g. 'usdc-ngn'
  from: string // asset code, e.g. 'USDC'
  to: string // fiat currency code, e.g. 'NGN'
  countryCode: string // ISO 3166-1 alpha-2
  countryName: string
}

// ─── Rate comparison ──────────────────────────────────────────────────────────

/** The fee structure an anchor charges for a given corridor and amount. */
export interface AnchorRate {
  anchorId: string
  anchorName: string
  corridorId: string
  fee: number // flat fee in USDC
  feeType: 'flat' | 'percent' | 'combined'
  exchangeRate: number // local currency units per 1 USDC
  totalReceived: number // computed: (amount - fee) * exchangeRate
  updatedAt: Date
  /** 'live' = fetched directly from the anchor API; 'estimated' = derived from market rates */
  source?: 'live' | 'estimated'
}

/** The result of comparing all anchor rates for a single corridor. */
export interface RateComparison {
  corridorId: string
  rates: AnchorRate[]
  bestRateId: string // anchorId of the anchor with the highest totalReceived
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

/** The current state of the Freighter browser extension. */
export interface FreighterState {
  isInstalled: boolean
  isConnected: boolean
  publicKey: string | null
  network: string | null
  error: string | null
}

// ─── SEP-1 ────────────────────────────────────────────────────────────────────

/** Per-anchor protocol capability flags derived from the resolved TOML. */
export interface AnchorCapabilities {
  sep10: boolean
  sep24: boolean
  sep38: boolean
  sep12: boolean
}

/** Relevant fields from a stellar.toml file resolved via SEP-1. */
export interface Sep1TomlData {
  TRANSFER_SERVER_SEP0024: string | undefined
  WEB_AUTH_ENDPOINT: string | undefined
  SIGNING_KEY: string | undefined
  CURRENCIES: Array<{ code: string; issuer?: string }> | undefined
  capabilities: AnchorCapabilities
}

/** A resolved anchor with protocol capabilities attached. */
export type ResolvedAnchor = Sep1TomlData

// ─── SEP-10 ───────────────────────────────────────────────────────────────────

/** A JWT issued by an anchor after successful SEP-10 authentication. */
export interface Sep10Auth {
  jwt: string
  anchorDomain: string
  publicKey: string
  expiresAt: Date
}

// ─── SEP-24 ───────────────────────────────────────────────────────────────────

/** Parameters for the SEP-24 GET /fee endpoint. */
export interface Sep24FeeParams {
  anchorDomain: string
  operation: 'deposit' | 'withdraw'
  assetCode: string
  assetIssuer: string
  amount: string
  type: 'bank_account' | 'cash' | 'mobile_money'
}

/** Body sent to POST /transactions/withdraw/interactive. */
export interface Sep24WithdrawRequest {
  assetCode: string
  assetIssuer: string
  amount: string
  account: string // user's Stellar public key
  jwt: string
}

/** Response from POST /transactions/withdraw/interactive. */
export interface Sep24WithdrawResponse {
  type: 'interactive_customer_info_needed'
  url: string
  id: string
}

/** All possible status values for a SEP-24 transaction. */
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

/** The live status of a SEP-24 withdrawal transaction. */
export interface WithdrawStatus {
  id: string
  status: WithdrawStatusValue
  amountIn?: string
  amountOut?: string
  amountFee?: string
  updatedAt: Date
  stellarTransactionId?: string
}

// ─── API ──────────────────────────────────────────────────────────────────────

/** Shape returned by GET /api/rates. */
export interface ApiRatesResponse {
  rates: RateComparison
  fetchedAt: string
}

/** Shape returned by API routes on error. */
export interface ApiError {
  code: string
  message: string
  anchorId?: string
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

/** A country supported by the off-ramp module. */
export interface Country {
  code: string // ISO 3166-1 alpha-2
  name: string
  currency: string // ISO 4217
  currencySymbol: string
  flag: string
}

export type OfframpSortKey = 'rate' | 'fee' | 'time' | 'total'
export type SortDirection = 'asc' | 'desc'
export type RiskLevel = 'low' | 'medium' | 'high'

// ─── Stellar assets (used by Horizon swap routing) ────────────────────────────

export interface StellarAsset {
  code: string
  issuer?: string
  name: string
  logoUrl?: string
}

export interface SwapRoute {
  routeId: string
  source: 'SDEX' | 'Soroswap' | 'Phoenix' | 'Aquarius'
  fromAsset: StellarAsset
  toAsset: StellarAsset
  fromAmount: number
  toAmount: number
  price: number
  priceImpact: number
  fee: number
  path: StellarAsset[]
  estimatedTime: string
  lastUpdated: Date
}
