# Stellar Intel Codebase Exploration Report

**Date:** May 29, 2026  
**Scope:** Intent types, SEP-38, quotes, test patterns, deadline validation, floor validation

---

## 1. Intent Types & Schema (PLANNED, NOT YET IMPLEMENTED)

### Status
- **types/intent.ts** — **DOES NOT EXIST** (planned for v1.2)
- Intent types are documented in `docs/ARCHITECTURE.md` but not yet in code

### Planned Type Definitions (from ARCHITECTURE.md § 3)

```typescript
// docs/ARCHITECTURE.md — lines 126-140
interface Intent {
  version: 1
  nonce: string                 // 128-bit random, replay protection
  account: string               // user's Stellar public key
  corridor: `${string}-${string}` // e.g. 'usdc-ngn'
  sellAsset: { code: string; issuer: string }
  sellAmount: string            // decimal string
  buyAsset: { code: string }    // fiat, e.g. 'NGN'
  minReceive: string            // floor on delivered amount
  deliveryHint: DeliveryHint    // bank / mobile-money / cash pickup
  deadline: string              // RFC3339
  preferences?: {
    allowSplit: boolean         // default: true
    maxAnchors: number          // default: 2
    preferAnchorIds?: string[]  // user whitelist
  }
}

interface SignedIntent {
  intent: Intent
  intentHash: string            // sha-256 over canonical JSON
  signature: string             // ed25519 over intentHash, by account
}

// Also planned: Plan and Outcome types (for router output and reputation writes)
interface Plan {
  // Single or split-anchor quote with scores
  anchors: Array<{
    anchorId: string
    amount: string
    quoteId: string
    score: number
    expiresAt: Date
  }>
}

interface Outcome {
  // Reputation write tuple
  intentHash: string
  anchorId: string
  corridorId: string
  quotedRate: number
  deliveredRate: number
  quotedAmount: string
  deliveredAmount: string
  settleSeconds: number
  outcome: 'completed' | 'refunded' | 'error'
  stellarTxId: string
  timestamp: Date
  disputed: boolean
}
```

### Related Planned Modules
- **lib/intent/canonical.ts** — Deterministic JSON canonicalization for hashing (PLANNED v1.2)
- **lib/router/** — Intent router & solver (PLANNED v1.2)
- **lib/publisher/** — Outcome publisher to Soroban (PLANNED v2)

---

## 2. SEP-38 Quote Fetching (PLANNED, NOT YET IMPLEMENTED)

### Status
- **lib/stellar/sep38.ts** — **DOES NOT EXIST** (planned for v1.1)
- Current implementation uses SEP-24 `/fee` + cached rates

### Planned SEP-38 Module
From ARCHITECTURE.md § 4.5:

```typescript
// lib/stellar/sep38.ts (planned)
// POST /sep38/quote
interface Sep38QuoteRequest {
  sell_asset: string              // e.g. 'USDC-...'
  sell_amount: string
  buy_asset: string               // e.g. 'NGN' (fiat)
  context: 'sep24'                // operation context
}

interface Sep38QuoteResponse {
  id: string                       // quote ID, passed to SEP-24 interactive
  price: number                    // local currency units per 1 USDC
  expires_at: string              // RFC3339
  total_price: number             // price with fees
  fee: {
    details?: Array<{ name: string; amount: string }>
    total: string                 // total fee in sell asset
  }
}
```

### Key Design Decisions
- SEP-38 RFQ is **parallel across all candidates** on a corridor
- Returned quote `id` is then passed to `POST /transactions/withdraw/interactive`
  to bind the anchor contractually to the price
- This is the evolution from "useful rate page" to "firm execution layer"

---

## 3. Existing Type Definitions in types/index.ts

### Anchor & Corridor Types (✅ EXIST)

```typescript
// lines 1-20
interface Anchor {
  id: string
  name: string
  homeDomain: string
  corridors: string[]             // corridor IDs this anchor serves
  assetCode: string
  assetIssuer: string
}

interface Corridor {
  id: string                       // e.g. 'usdc-ngn'
  from: string                     // asset code, e.g. 'USDC'
  to: string                       // fiat currency code, e.g. 'NGN'
  countryCode: string              // ISO 3166-1 alpha-2
  countryName: string
}
```

### Rate Comparison Types (✅ EXIST)

```typescript
// lines 22-46
interface AnchorRate {
  anchorId: string
  anchorName: string
  corridorId: string
  fee: number | null              // flat fee in USDC
  feeType: 'flat' | 'percent' | 'combined'
  exchangeRate: number | null     // local currency units per 1 USDC
  totalReceived: number | null    // computed: (amount - fee) * exchangeRate
  updatedAt: Date
  source: 'sep38' | 'sep24-fee' | 'unavailable'
}

interface RateComparison {
  corridorId: string
  rates: AnchorRate[]
  bestRateId: string              // anchorId of highest totalReceived
}
```

### SEP-Protocol Types (✅ EXIST)

```typescript
// lines 48-82
interface AnchorCapabilities {
  sep10: boolean
  sep24: boolean
  sep38: boolean                  // indicates ANCHOR_QUOTE_SERVER exists
  sep12: boolean
}

interface Sep1TomlData {
  domain: string
  TRANSFER_SERVER_SEP0024: string | null
  ANCHOR_QUOTE_SERVER: string | null  // indicates SEP-38 support
  WEB_AUTH_ENDPOINT: string | null
  SIGNING_KEY: string | null
  NETWORK_PASSPHRASE: string | null
  CURRENCIES: Array<{ code: string; issuer?: string }>
  capabilities: AnchorCapabilities
}

interface Sep10Auth {
  jwt: string
  anchorDomain: string
  publicKey: string
  expiresAt: Date                 // Expires field for JWT validation
}
```

### SEP-24 Withdrawal Types (✅ EXIST)

```typescript
// lines 100-152
type WithdrawStatusValue =
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
  | 'no_market'           // ← Floor violations detected via status
  | 'too_small'           // ← Floor validation feedback
  | 'too_large'
  | 'expired'             // ← Deadline violation feedback

interface Sep24Transaction {
  id: string
  status: WithdrawStatusValue
  amountIn?: string
  amountInAsset?: string
  amountOut?: string
  amountOutAsset?: string
  amountFee?: string
  updatedAt: Date
  stellarTransactionId?: string
  externalTransactionId?: string
  refunds?: Sep24Refunds
}
```

---

## 4. Deadline & Floor Validation

### Current Implementation (✅ LIVE)

#### Floor Validation (minReceive)
- **Location:** Anchor onboarding templates mention "Floor: ₦1,500" for NGN corridors
- **Mechanism:** Anchors return status `too_small` when delivered amount falls below minimum
- **SEP-24 Status Handler:** `tests/sep24-status-map.spec.ts` maps anchor statuses to app canonical statuses
- **Method:** Floor is part of negotiated quote terms; anchor enforces server-side

**Example from `.github/ISSUE_TEMPLATE/anchor-onboard.yml` (line 135):**
```
Flat $0.50 USDC + 0.5% spread over Binance mid-market. Floor: ₦1,500
```

#### Deadline Validation (expires_at)
- **Location:** Types in `Sep10Auth.expiresAt` and planned `Intent.deadline`
- **Current Use:** JWT expires tracked locally; no server-side deadline enforcement yet
- **Planned (v1.2):** Intent contains RFC3339 `deadline` field; router will reject quotes after deadline

#### Status Constants for Terminal States
**Location:** `lib/stellar/sep24.ts` lines 10-13
```typescript
export const TERMINAL_STATES: ReadonlySet<WithdrawStatusValue> = new Set([
  'completed',
  'error',
  'refunded',
  'expired',      // ← Deadline expired
  'no_market',    // ← Floor/market validation failed
  'too_small',    // ← Floor violation
  'too_large',
])
```

---

## 5. Test Patterns & Fixtures

### Test Setup Pattern (✅ ESTABLISHED)

**Framework:** Vitest with `vi.mock()`, `vi.spyOn()`, `vi.stubGlobal()`

**Setup File:** `tests/setup.ts`
```typescript
// Established testing library dependencies
import '@testing-library/jest-dom'
```

**Example Pattern from `tests/lib/sep24.test.ts`:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.restoreAllMocks()  // Clean state between tests
})

describe('fetchAnchorFee', () => {
  it('constructs the correct fee URL with all query parameters', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url
      return { ok: true, json: async () => ({ fee: '2.00' }) }
    }))

    await fetchAnchorFee(params)
    expect(capturedUrl).toContain('operation=withdraw')
  })
})
```

### Fixtures (✅ EXIST)

**SEP-1 TOML Fixtures:** `tests/fixtures/sep1/`
- `bitso.toml`
- `cowrie.toml`
- `flutterwave.toml`
- `moneygram.toml`
- `mychoice.toml`
- `tempo.toml`

**Mock Anchor Factory Pattern** (from `tests/rate-ranking.spec.ts`):
```typescript
function createMockRate(
  anchorId: string,
  totalReceived: number,
  overrides?: Partial<AnchorRate>
): AnchorRate {
  return {
    anchorId,
    anchorName: `Anchor ${anchorId}`,
    corridorId: 'usdc-ngn',
    fee: 2.5,
    feeType: 'flat',
    exchangeRate: 1580,
    totalReceived,
    source: 'sep24-fee',
    updatedAt: new Date(),
    ...overrides,
  }
}
```

### Property-Based Testing Pattern (✅ ESTABLISHED)

**Framework:** `fast-check`

**Example from `tests/compute-total.spec.ts`:**
```typescript
import fc from 'fast-check'

describe('computeTotalReceived - Property-Based Tests', () => {
  const amountArb = fc.double({ min: 0, max: 1_000_000, noNaN: true })
  const feeArb = fc.double({ min: 0, max: 100_000, noNaN: true })
  
  it('total received is always non-negative', () => {
    fc.assert(
      fc.property(amountArb, feeArb, (amount, fee) => {
        const result = computeTotalReceived(amount, fee, 0, 1580)
        expect(result).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 1000 }
    )
  })
})
```

### Integration Test Pattern (✅ EXISTS)

**File:** `tests/intent-e2e.spec.ts`
```typescript
// End-to-end: builds payment, signs with Freighter mock, verifies on horizon
const INTENT_FIXTURE = {
  sourcePublicKey: sourceKeypair.publicKey(),
  anchorAccount: Keypair.random().publicKey(),
  amount: '42.5',
  memo: 'intent-memo',
  memoType: 'text',
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
}

describe('Intent end-to-end round trip', () => {
  it('builds a withdrawal intent, signs it with Freighter, verifies it on server', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(mockAccount)
    vi.spyOn(horizonServer, 'fetchBaseFee').mockResolvedValue(100)
    // ... mock Freighter, verify signatures
  })
})
```

### Sort Stability & Determinism Tests (✅ ESTABLISHED)

**From:** `tests/rate-ranking.spec.ts`
```typescript
describe('computeRateComparison — sort stability', () => {
  it('returns the same bestRateId given identical inputs', () => {
    const comparison1 = computeRateComparison(results, 'usdc-ngn')
    const comparison2 = computeRateComparison(results, 'usdc-ngn')
    expect(comparison1.bestRateId).toBe(comparison2.bestRateId)
  })
})

describe('computeRateComparison — monotonicity', () => {
  it('ensures bestRateId has the highest totalReceived value', () => {
    // Verify that the selected anchor has max rate across all results
  })
})
```

---

## 6. Constants & Utilities for Validation

### Deadline/Expiry Constants

**Location:** Types use `expiresAt: Date` but no global deadline constant yet

**Planned (v1.2):** Will be added per-corridor or globally in `constants/`

### Floor Validation Constants

**Current:** Floor is part of anchor's SEP-38 quote response

**Planned:** Global validation thresholds in `constants/index.ts`

### Utilities for Rate Computation

**Location:** `lib/utils.ts`

```typescript
export function computeTotalReceived(
  amount: number,
  fee: number,
  feePercent: number,
  exchangeRate: number
): number {
  const afterFlat = Math.max(0, amount - fee)
  const afterPercent = afterFlat * (1 - feePercent / 100)
  return afterPercent * exchangeRate
}

export function formatCurrency(amount: number, currencyCode: string): string {
  // Intl.NumberFormat for localized display
}

export function formatRate(rate: number, from: string, to: string): string {
  // e.g. "1 USDC = 1,580 NGN"
}
```

### Error Classes for Validation

**Location:** `lib/stellar/errors.ts`

```typescript
export class SepError extends Error {
  code: string
  httpStatus: number
  raw: unknown
  // Parses anchor error responses
}

export function parseSepErrorBody(body: unknown, status: number): SepError {
  // Normalizes { error: string, code: string } | { error: { message } } | string
}
```

---

## 7. Router & Solver Logic (PLANNED v1.2)

### Planned Scoring Formula (from ARCHITECTURE.md § 5)

```
score(anchor, amount) = 
  + grossRate(anchor, amount)              // SEP-38 firm rate
  - feeFrac(anchor, amount)                // anchor fee as % of sell
  - slippagePenalty(anchor, amount)        // historical quote → delivered delta
  - failurePenalty(anchor)                 // (1 − fillRate) from oracle
  × settlementDiscount(anchor)             // 1 / (1 + latency_hours × λ)
```

### Splitting Decision (Planned)

Split is proposed **only when**:
1. At least 2 anchors quoted in last 30 seconds
2. Split score > best single score − fixed fee of second leg
3. Both anchors have `fillRate > 0.9` (floor default)

### Route Implementation

**Planned Location:** `lib/router/solver.ts`  
**Inputs:** Draft `Intent` + live SEP-38 quotes (parallel RFQ)  
**Output:** `Plan` (single or split)  
**Oracle Dependency:** Reads `fillRate`, `slippagePenalty`, `latency` from Soroban

---

## 8. File Inventory Summary

### ✅ EXIST (Live on main)

| Path | Purpose |
| --- | --- |
| `types/index.ts` | Anchor, Corridor, AnchorRate, WithdrawStatus, SEP auth types |
| `lib/stellar/sep1.ts` | stellar.toml resolver, ANCHOR_QUOTE_SERVER extraction |
| `lib/stellar/sep10.ts` | Challenge → sign → JWT flow, mainnet pinning |
| `lib/stellar/sep24.ts` | `/fee`, `/interactive`, `/transaction` clients |
| `lib/stellar/horizon.ts` | Build + sign + submit user payment |
| `lib/stellar/anchors.ts` | Registry + SEP-1 resolution helpers |
| `lib/utils.ts` | `computeTotalReceived()`, formatting helpers |
| `constants/anchors.ts` | ANCHORS[], CORRIDORS[] registry |
| `tests/compute-total.spec.ts` | Property-based tests for fee math |
| `tests/rate-ranking.spec.ts` | Sort stability, monotonicity, determinism |
| `tests/intent-e2e.spec.ts` | Freighter mock, payment signing, Horizon submit |
| `tests/fixtures/sep1/` | Anchor TOML fixtures |

### 🛠️ PLANNED (v1.1–v4)

| Path | Status | Purpose |
| --- | --- | --- |
| `types/intent.ts` | v1.2 | Intent, SignedIntent, Plan, Outcome schemas |
| `lib/intent/canonical.ts` | v1.2 | Deterministic JSON → hash → sign |
| `lib/stellar/sep38.ts` | v1.1 | SEP-38 firm-quote RFQ (parallel) |
| `lib/router/` | v1.2 | Intent router: scoring, splitting, solving |
| `lib/publisher/` | v2 | Outcome publisher → Soroban contract |
| `contracts/oracle/` | v2 | Soroban oracle: store + read reputation |
| `packages/mcp/` | v4 | MCP server: tools for agents |
| `packages/sdk/` | v4 | TypeScript client + types |

---

## 9. Key Invariants & Architecture Decisions

### Trust Boundaries (from ARCHITECTURE.md § 9)

1. **No user keys held** — Signing in Freighter (web) or caller's wallet (agent); none transmitted
2. **No user funds held** — Payment flows directly user → anchor; no intermediary
3. **Network pinned** — SEP-10 challenge must be mainnet or rejected
4. **Outcomes user-witnessed** — Every reputation write references user-signed intent_hash
5. **Publisher cannot invent** — Signs transport, not content; contract verifies on-ledger existence

### Determinism Requirements

- Router is deterministic given same inputs + oracle snapshot
- Replay audit trail: input intent → signature → quote ID → outcome

---

## 10. Next Steps for Implementation

1. **Create types/intent.ts** with Intent, SignedIntent, Plan, Outcome
2. **Create lib/intent/canonical.ts** for deterministic JSON hashing
3. **Create lib/stellar/sep38.ts** with parallel RFQ logic
4. **Create lib/router/** with scoring, determinism, and split logic
5. **Write comprehensive tests** matching patterns established in sep24, rate-ranking, intent-e2e
6. **Define deadline & floor constants** in constants/ once router requires them

---

**Generated:** 2026-05-29  
**Codebase:** stellar-intel v1.0 (main)
