/**
 * Intent schema and related types for the Stellar Intel intent router.
 * See docs/INTENT_API.md for the full specification.
 */

// ─── Intent ─────────────────────────────────────────────────────────────────────

/** Delivery method hint for the off-ramp. */
export type DeliveryHint = 'bank_account' | 'mobile_money' | 'cash_pickup'

/** User preferences for intent routing. */
export interface IntentPreferences {
  allowSplit: boolean
  maxAnchors: number
  preferAnchorIds?: string[]
}

/**
 * A user's intent to exchange one asset for another.
 * This is the canonical statement of purpose that the router operates on.
 */
export interface Intent {
  version: 1
  nonce: string // 128-bit random, replay protection
  account: string // user's Stellar public key
  corridor: `${string}-${string}` // e.g. 'usdc-ngn'
  sellAsset: { code: string; issuer: string }
  sellAmount: string // decimal string
  buyAsset: { code: string } // fiat, e.g. 'NGN'
  minReceive: string // floor on delivered amount
  deliveryHint: DeliveryHint
  deadline: string // RFC3339
  preferences?: IntentPreferences
}

/**
 * A signed intent, ready for submission to the router.
 */
export interface SignedIntent {
  intent: Intent
  intentHash: string // sha-256 over canonical JSON
  signature: string // ed25519 over intentHash, by account
}

// ─── Quote ─────────────────────────────────────────────────────────────────────

/**
 * A firm quote from an anchor for a specific amount.
 * Comes from SEP-38 /quote endpoint.
 */
export interface AnchorQuote {
  anchorId: string
  anchorName: string
  anchorDomain: string
  quoteId: string // from SEP-38
  price: number // local currency units per 1 USDC
  expiresAt: string // RFC3339
  fee: number // anchor fee in sell asset
  totalFee: number // total fee including Stellar network fee
  totalReceive: number // amount user will receive in buy asset
  source: 'sep38' | 'sep24-fee'
}

// ─── Output Envelope ────────────────────────────────────────────────────────────

/**
 * An unsigned Stellar transaction XDR.
 * This is what the user signs in Freighter to execute the payment.
 */
export interface UnsignedTransaction {
  xdr: string // Stellar transaction XDR, unsigned
  networkPassphrase: string // e.g. 'Public Global Stellar Network ; September 2015'
  description: string // human-readable description of what this transaction does
}

/**
 * A single leg in a plan (one anchor, one quote, one transaction).
 * This is the output envelope for a single-anchor execution.
 */
export interface PlanLeg {
  anchor: {
    id: string
    name: string
    homeDomain: string
  }
  quote: AnchorQuote
  unsignedTransaction: UnsignedTransaction
  expectedDelivery: {
    amount: string // in buy asset
    currency: string // e.g. 'NGN'
    estimatedSeconds: number // time to settlement
  }
}

/**
 * The router's output envelope.
 * Contains everything needed to execute the intent:
 * - Selected anchor(s) with their quotes
 * - Unsigned transaction(s) for the user to sign
 * - Expected delivery information
 */
export interface Plan {
  intentHash: string // hash of the original intent
  legs: PlanLeg[] // one or more legs (single anchor or split)
  totalExpectedReceive: string // sum of all legs' expected delivery
  totalFee: string // sum of all fees
  isSplit: boolean // true if legs.length > 1
  createdAt: string // RFC3339
  expiresAt: string // RFC3339 - when quotes expire
}

// ─── Outcome ────────────────────────────────────────────────────────────────────

/**
 * The result of executing an intent.
 * This is what gets written to the reputation oracle.
 */
export type OutcomeType = 'completed' | 'refunded' | 'error'

export interface Outcome {
  intentHash: string
  anchorId: string
  corridor: string
  quotedRate: string // from the original quote
  deliveredRate: string // actual rate achieved
  quotedAmount: string // amount user expected to receive
  deliveredAmount: string // amount user actually received
  settleSeconds: number // time from quote to settlement
  outcome: OutcomeType
  stellarTxId?: string // on-chain transaction ID
  timestamp: string // RFC3339
}
