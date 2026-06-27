# Technical Design: Fallback Anchor Resolution

## Overview

This design specifies the fallback anchor resolution system, which automatically retries quote resolution with alternative anchors when the initially selected anchor rejects a firm quote or the quote expires before confirmation. The system maintains a maximum of 3 total attempts (1 initial + 2 fallbacks) while preserving a unified user experience and tracking comprehensive attempt history for reputation scoring.

### Key Design Goals

1. **Reliability**: Maximize transaction success rates through intelligent fallback
2. **Performance**: Use parallel quote fetching to minimize latency
3. **Observability**: Log all attempts for reputation and auditing
4. **Determinism**: Consistent quote selection and attempt ordering
5. **Correctness**: Enforce attempt limits and candidate exhaustion
6. **User Experience**: Present single coherent result despite internal retries

---

## Architecture

### 2.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Caller (Router/API)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  solve(params)                                          │   │
│  │  ├─ Get candidate anchors                              │   │
│  │  ├─ Fetch quotes in parallel (Promise.all)             │   │
│  │  ├─ Select best by totalReceived                       │   │
│  │  ├─ Log attempt                                        │   │
│  │  └─ Return SolveResult                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│            ▲                                                    │
│            │                                                    │
│  ┌─────────┴─────────────────────────────────────────────────┐ │
│  │ handleQuoteRejection(rejectedAnchorId, previousAttempts)  │ │
│  │ ├─ Mark anchor as failed                                  │ │
│  │ ├─ Filter remaining candidates                            │ │
│  │ ├─ Fetch quotes in parallel (Promise.all)                 │ │
│  │ ├─ Select best from remaining                             │ │
│  │ ├─ Log rejection + fallback attempts                       │ │
│  │ └─ Return SolveResult with complete history               │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  logSolveAttempt(solveRequestId, attempt, remaining)      │ │
│  │  └─ Emit structured log for reputation system             │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│              External Systems                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Anchor SEP-24   │  │ Anchor       │  │ Log Aggregation  │  │
│  │ Transfer        │  │ Resolution   │  │ (Reputation)     │  │
│  │ Servers         │  │ (stellar.    │  │                  │  │
│  │ (getSep24Fee)   │  │ toml)        │  │ logStructured()  │  │
│  └─────────────────┘  └──────────────┘  └──────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Control Flow: solve() and handleQuoteRejection()

```
User initiates solve for corridor
         │
         ▼
    solve(params)
         │
    ┌────┴─────────────────────────────┐
    │ For attemptNumber = 1 to 3:       │
    │                                   │
    │  1. Get all anchors               │
    │  2. Filter out failed anchors     │
    │  3. Fetch quotes in parallel      │
    │  4. Select best quote             │
    │  5. Log attempt                   │
    │  6. Return result on success      │
    │                                   │
    │  If error: continue to next       │
    │  If success: RETURN               │
    └────┴─────────────────────────────┘
         │
         ├─ Success? ──→ Return SolveResult
         │
         └─ Failure? ──→ Return error
              
             [External: Quote Used]
                  │
                  ▼
             Quote is rejected OR expires
                  │
                  ▼
         handleQuoteRejection(rejectedAnchorId, attempts)
                  │
          ┌───────┴──────────────────┐
          │ 1. Create rejection       │
          │    attempt                │
          │ 2. Mark anchor as failed  │
          │ 3. Fetch from remaining   │
          │    candidates in parallel │
          │ 4. Select best from       │
          │    remaining              │
          │ 5. Create fallback        │
          │    attempt                │
          │ 6. Log both attempts      │
          │ 7. Return combined result │
          └───────┬──────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
     Success            Exhaustion/Limit
        │                    │
        ▼                    ▼
   Return new         Return failure
   selected anchor
```

---

## 3. Data Flow: Initial Solve

### 3.1 Initial Solve Sequence Diagram

```
Caller         solve()         Anchors         Logger
  │                │              │              │
  ├─ corridorId    │              │              │
  ├─ amount   ────→│              │              │
  │                │              │              │
  │           [Get candidate anchors]            │
  │                │              │              │
  │           [Fetch quotes in parallel]         │
  │                │────────→ anchor1: getFee    │
  │                │────────→ anchor2: getFee    │
  │                │────────→ anchor3: getFee    │
  │                │              │              │
  │                │←──── rate1: 100            │
  │                │←──── rate2: 95             │
  │                │←──── rate3: 98             │
  │                │              │              │
  │           [Select best: rate1]               │
  │                │              │              │
  │                ├─ SolveAttempt ─────────────→│
  │                │  (attempt=1,               │
  │                │   selectedAnchor=anchor1,  │
  │                │   quote=rate1,             │
  │                │   error=null)              │
  │                │              │              │
  │                │ SolveResult ──│──→ logged   │
  │←── result ─────┤ (success=true)              │
  │   (anchor1,    │
  │    rate1)      │
  │                │
  ▼                ▼
```

### 3.2 Initial Solve Data Flow (Pseudocode)

```typescript
// Input: solve parameters
corridorId: "usdc-ngn"
amount: "100"
assetCode: "USDC"
assetIssuer: "GBUQWP3BOUZX34CAMPANQVM67KPRJAFVSJU7SALOMAJBLARHAVZLKODLA"
feeType: "bank_account"

// Step 1: Initialize
solveRequestId = generateRequestId()  // e.g., "req-abc123"
attempts = []
failedAnchorIds = new Set()

// Step 2: Attempt 1 (main loop iteration)
attemptNumber = 1
attemptStartTime = Date.now()

// Step 3: Get candidates
allAnchors = getAnchorsByCorridorId("usdc-ngn")
// Returns: [anchor1, anchor2, anchor3, ...]

// Step 4: Filter
candidateAnchors = allAnchors.filter(a => !failedAnchorIds.has(a.id))
// Same as allAnchors on first attempt

// Step 5: Fetch quotes in parallel
quotePromises = candidateAnchors.map(anchor => {
  return getSep24Fee({
    transferServer: anchor.TRANSFER_SERVER_SEP0024,
    assetCode: "USDC",
    assetIssuer: "GBUQW...",
    amount: "100",
    type: "bank_account"
  })
})

quoteResults = await Promise.all(quotePromises)
// Each result: { anchorId, anchorName, quote: AnchorRate | null, error: string | null }

// Step 6: Filter valid quotes
validQuotes = quoteResults.filter(r => r.quote !== null)
// Removes anchors that failed or returned null

// Step 7: Sort and select
validQuotes.sort((a, b) => b.quote.totalReceived - a.quote.totalReceived)
bestQuote = validQuotes[0]

// Output: bestQuote contains the highest totalReceived (best rate)
// Example: { anchorId: "anchor1", quote: { totalReceived: 99.5, ... } }

// Step 8: Log
durationMs = Date.now() - attemptStartTime
attempt: SolveAttempt = {
  attemptNumber: 1,
  selectedAnchorId: bestQuote.anchorId,
  selectedAnchorName: bestQuote.anchorName,
  quote: bestQuote.quote,
  error: null,
  timestamp: "2025-01-15T12:34:56.789Z",
  durationMs: 245
}

logSolveAttempt(
  solveRequestId="req-abc123",
  params={ corridorId: "usdc-ngn", amount: "100" },
  attempt,
  candidatesRemaining = 2  // 3 anchors - 1 selected
)

// Returns to caller
return {
  success: true,
  selectedAnchor: ResolvedAnchor,
  selectedRate: AnchorRate,
  attempts: [attempt],
  finalError: null,
  solveRequestId: "req-abc123"
}
```

---

## 4. Data Flow: Rejection and Fallback

### 4.1 Rejection and Fallback Sequence Diagram

```
External       handleQuoteRejection()   Anchors         Logger
System         (rejection handler)       │              │
  │                                      │              │
  │ Quote rejected ─────────────────────→│              │
  │ (rejectedAnchorId=anchor1)           │              │
  │ (previousAttempts=[attempt1])        │              │
  │                                      │              │
  │            [Create rejection attempt]               │
  │                                      │              │
  │ ┌─ Log rejection  ───────────────────┼─────────────→│
  │ │  (attemptNumber=2, error="...")    │              │
  │ │                                    │              │
  │ └─ [Filter remaining: {anchor2, anchor3}]          │
  │                                      │              │
  │            [Fetch quotes in parallel]               │
  │                   ─────────────→ anchor2: getFee    │
  │                   ─────────────→ anchor3: getFee    │
  │                   ←─────── rate2: 95               │
  │                   ←─────── rate3: 98               │
  │                                      │              │
  │            [Select best from remaining: rate3=98]  │
  │                                      │              │
  │            [Create fallback attempt]                │
  │                                      │              │
  │            [Log fallback] ──────────→│
  │            (attemptNumber=3,          │
  │             selectedAnchor=anchor3,   │
  │             quote=rate3,              │
  │             error=null)               │
  │                                      │              │
  │ SolveResult ─────────────────────────→ result logged
  │ (success=true,
  │  selectedAnchor=anchor3,
  │  attempts=[attempt1, rejAttempt,
  │            fallbackAttempt])
  │
  ▼
```

### 4.2 Rejection and Fallback Data Flow (Pseudocode)

```typescript
// Input from external system
rejectedAnchorId = "anchor1"
previousAttempts = [
  {
    attemptNumber: 1,
    selectedAnchorId: "anchor1",
    quote: { totalReceived: 99.5, ... },
    error: null
  }
]

solveRequestId = generateRequestId()  // New request correlation ID

// Step 1: Create rejection attempt
rejectionAttempt: SolveAttempt = {
  attemptNumber: 2,  // previous length (1) + 1
  selectedAnchorId: "anchor1",
  selectedAnchorName: "unknown",  // Not fetched in rejection case
  quote: null,
  error: "Quote rejected by anchor",
  timestamp: "2025-01-15T12:34:58.123Z",
  durationMs: undefined  // Not computed for rejection
}

// Step 2: Build failed set
failedAnchorIds = new Set(["anchor1"])

// Add any previously failed anchors
for (attempt of previousAttempts) {
  if (attempt.error !== null) {
    failedAnchorIds.add(attempt.selectedAnchorId)
  }
}

// Step 3: Get remaining candidates
allAnchors = getAnchorsByCorridorId("usdc-ngn")
// Returns: [anchor1, anchor2, anchor3]

candidateAnchors = allAnchors.filter(a => !failedAnchorIds.has(a.id))
// Result: [anchor2, anchor3]

// Step 4: Enforce max attempts
successfulAttempts = previousAttempts.filter(a => a.error === null).length
// Result: 1

if (successfulAttempts >= 2) {
  // Max 3 attempts total = 2 successful + 1 failure/fallback allowed
  return {
    success: false,
    attempts: [...previousAttempts, rejectionAttempt],
    finalError: "Max fallback attempts exhausted (2 fallbacks allowed)"
  }
}

// Step 5: Fetch from remaining
quotePromises = candidateAnchors.map(anchor => getSep24Fee(...))
quoteResults = await Promise.all(quotePromises)
validQuotes = quoteResults.filter(r => r.quote !== null)

// Result: [{ anchorId: "anchor2", quote: {...} }, { anchorId: "anchor3", quote: {...} }]

// Step 6: Sort and select best from remaining
validQuotes.sort((a, b) => b.quote.totalReceived - a.quote.totalReceived)
// If: anchor2=95, anchor3=98 → sorted order: [anchor3, anchor2]

bestFromRemaining = validQuotes[0]  // anchor3 with 98

// Step 7: Create fallback attempt
fallbackAttempt: SolveAttempt = {
  attemptNumber: 3,  // previous length (1) + 2
  selectedAnchorId: "anchor3",
  selectedAnchorName: "anchor3name",
  quote: bestFromRemaining.quote,
  error: null,
  timestamp: "2025-01-15T12:34:58.500Z",
  durationMs: 150
}

// Step 8: Log both attempts
logSolveAttempt(solveRequestId, params, rejectionAttempt, remainingCount=2)
logSolveAttempt(solveRequestId, params, fallbackAttempt, remainingCount=1)

// Step 9: Return combined result
return {
  success: true,
  selectedAnchor: ResolvedAnchor("anchor3"),
  selectedRate: bestFromRemaining.quote,
  attempts: [
    previousAttempts[0],      // Original attempt 1
    rejectionAttempt,         // Rejection attempt 2
    fallbackAttempt           // Fallback attempt 3
  ],
  finalError: null,
  solveRequestId: "req-xyz789"
}
```

---

## Components and Interfaces

### SolveAttempt Interface

```typescript
/**
 * Represents a single attempt in the solve resolution flow.
 * 
 * Semantics:
 * - For successful attempts: error === null, quote !== null
 * - For rejection attempts: error === "Quote rejected by anchor", quote === null
 * - For failed attempts: error === specific error message, quote === null
 * - attemptNumber is the sequential attempt in the flow: 1, 2, or 3
 * - timestamp is recorded at creation time in ISO 8601 format
 * - durationMs captures network + processing time from start to completion
 */
export interface SolveAttempt {
  /**
   * Sequential attempt number: 1 (initial), 2 (first fallback), 3 (second fallback).
   * Strictly enforced to be 1, 2, or 3.
   */
  attemptNumber: 1 | 2 | 3

  /**
   * The ID of the anchor selected (or attempted) in this attempt.
   * For rejection attempts: the ID of the anchor that rejected.
   * For successful/failed attempts: the ID of the selected anchor.
   */
  selectedAnchorId: string

  /**
   * The human-readable name of the selected anchor.
   * May be 'unknown' if name resolution fails (e.g., in rejection case).
   */
  selectedAnchorName: string

  /**
   * The quote from the selected anchor, or null if:
   * - Attempt failed or errored
   * - This is a rejection attempt
   * - No valid quote was returned
   *
   * When not null, quote is a fully-constructed AnchorRate with:
   * - fee: flat fee in USDC (or null if unreachable)
   * - exchangeRate: local currency units per 1 USDC (or null if unreachable)
   * - totalReceived: (amount - fee) * exchangeRate (computed)
   * - updatedAt: timestamp of quote
   */
  quote: AnchorRate | null

  /**
   * Error message if the attempt failed, or null if successful.
   * 
   * Specific values:
   * - null: successful attempt
   * - "Quote rejected by anchor": explicit rejection
   * - "No transfer server available": anchor missing SEP-24 capability
   * - "Fee fetch failed: <reason>": network or protocol error
   * - "Unknown error": unclassified failure
   */
  error: string | null

  /**
   * Timestamp of attempt creation/completion in ISO 8601 format.
   * Example: "2025-01-15T12:34:56.789Z"
   */
  timestamp: string

  /**
   * Duration in milliseconds from attempt start to completion.
   * Includes network latency for SEP-24 fee fetch.
   * May be undefined for rejection attempts (not computed).
   */
  durationMs?: number
}

/**
 * Result of the solve() or handleQuoteRejection() function.
 * 
 * Semantics:
 * - If success === true: selectedAnchor and selectedRate contain final choice
 * - If success === false: selectedAnchor and selectedRate are null, finalError explains why
 * - attempts array contains ALL attempts in chronological order (audit trail)
 * - solveRequestId correlates all attempts in the same solve flow
 * 
 * The SolveResult is the internal representation. External APIs present only
 * success/failure and final result; the attempts array is internal audit data.
 */
export interface SolveResult {
  /**
   * Whether the solve succeeded (found a valid quote).
   * true: selectedAnchor and selectedRate are valid and can be used
   * false: no valid quote available; finalError explains why
   */
  success: boolean

  /**
   * The selected anchor (if success === true), or null.
   * This is the ResolvedAnchor containing SEP-1 capabilities.
   * Type: ResolvedAnchor | null (from types/index.ts)
   */
  selectedAnchor: ResolvedAnchor | null

  /**
   * The selected rate (if success === true), or null.
   * Contains fee, exchangeRate, totalReceived, and other rate metadata.
   * Type: AnchorRate | null (from types/index.ts)
   */
  selectedRate: AnchorRate | null

  /**
   * Complete history of all attempts in chronological order.
   * This array is immutable after return and includes:
   * - Initial solve attempts
   * - Rejection attempts (if triggered)
   * - Fallback attempts (if triggered)
   * 
   * The attempts array enables:
   * - Reputation system to identify rejection patterns
   * - Audit trail for debugging
   * - Post-execution analysis
   * 
   * Example with one rejection and fallback:
   * [
   *   { attemptNumber: 1, selectedAnchorId: "anchor1", quote: {...}, error: null },
   *   { attemptNumber: 2, selectedAnchorId: "anchor1", quote: null, error: "Quote rejected by anchor" },
   *   { attemptNumber: 3, selectedAnchorId: "anchor2", quote: {...}, error: null }
   * ]
   */
  attempts: SolveAttempt[]

  /**
   * Final error message (if success === false), or null.
   * 
   * Specific values:
   * - null: success === true
   * - "No anchors available for corridor {corridorId}": no anchors service corridor
   * - "All anchors have been exhausted after rejection attempts": all anchors tried and failed
   * - "No remaining anchors after rejection": rejection occurred but no fallback candidates
   * - "No valid quotes received from any anchor": all anchors returned null/error
   * - "No valid quotes from remaining anchors": fallback attempt with no valid fallback quotes
   * - "Max fallback attempts exhausted (2 fallbacks allowed)": max 3 attempts reached
   */
  finalError: string | null

  /**
   * Unique correlation ID for this solve flow.
   * Used by logging and reputation systems to link all attempts.
   * Generated by generateRequestId() and shared across solve + rejection handlers.
   * Example: "req-f47ac10b58cc4372a6d7ba6c"
   */
  solveRequestId?: string
}

/**
interface SolveAttemptLog {
  /**
   * When the attempt completed (ISO 8601)
   */
  timestamp: string

  /**
   * Unique identifier for the solve request (all attempts in same request share ID)
   */
  solveRequestId: string

  /**
   * The corridor being solved (e.g., "usdc-ngn")
   */
  corridorId: string

  /**
   * The amount requested (e.g., "100")
   */
  amount: string

  /**
   * Which attempt number this is: 1, 2, or 3
   */
  attemptNumber: 1 | 2 | 3

  /**
   * ID of the anchor selected (or attempted)
   */
  selectedAnchorId: string

  /**
   * Name of the anchor
   */
  selectedAnchorName: string

  /**
   * Whether the attempt succeeded (error === null)
   */
  success: boolean

  /**
   * Duration in milliseconds
   */
  durationMs: number

  /**
   * Total attempts allowed (always 3)
   */
  totalAttempts: 3

  /**
   * Number of candidate anchors not yet tried (excluding selected)
   */
  remainingCandidates: number

  /**
   * Error message (if success === false)
   */
  error?: string
}
```

---

## Data Models
```

### Type Relationships

```
solve(params: SolveParams) ──────→ SolveResult
                                      ├─ attempts: SolveAttempt[]
                                      ├─ selectedAnchor: ResolvedAnchor
                                      ├─ selectedRate: AnchorRate
                                      └─ finalError: string

handleQuoteRejection(
  rejectedAnchorId: string,
  previousAttempts: SolveAttempt[],
  params: SolveParams
) ─────→ SolveResult (with expanded attempts array)

logSolveAttempt(
  solveRequestId: string,
  params: SolveParams,
  attempt: SolveAttempt,
  candidatesRemaining: number
) ────→ void (emits SolveAttemptLog via logStructured)
```

---

## Data Models

### Attempt Data Model

```typescript
/**
 * Pseudocode for solve() implementation
 */
function solve(params: SolveParams): Promise<SolveResult> {
  // Initialize
  solveRequestId = generateRequestId()
  attempts = []
  failedAnchorIds = new Set()

  // Main loop: max 3 attempts
  for (attemptNumber from 1 to 3) {
    attemptStartTime = Date.now()

    try {
      // Get all anchors for corridor
      allAnchors = getAnchorsByCorridorId(params.corridorId)

      if (allAnchors.length === 0) {
        finalError = `No anchors available for corridor ${params.corridorId}`
        break  // Early exit: no candidates
      }

      // Filter out failed anchors
      candidateAnchors = allAnchors.filter(a => 
        !failedAnchorIds.has(a.id)
      )

      if (candidateAnchors.length === 0) {
        finalError = "All anchors have been exhausted after rejection attempts"
        break  // Early exit: no candidates remain
      }

      // Parallel quote fetch
      quotePromises = candidateAnchors.map(anchor => 
        fetchAnchorQuote(anchor, params)
      )
      quoteResults = await Promise.all(quotePromises)

      // Filter to valid quotes (non-null)
      validQuotes = quoteResults.filter(r => r.quote !== null)

      if (validQuotes.length === 0) {
        finalError = "No valid quotes received from any anchor"
        continue  // Try next iteration (if not final)
      }

      // Select best by totalReceived (descending order)
      validQuotes.sort((a, b) => 
        b.quote.totalReceived - a.quote.totalReceived
      )
      bestQuote = validQuotes[0]

      // Log successful attempt
      durationMs = Date.now() - attemptStartTime
      attempt = createAttempt(
        attemptNumber,
        bestQuote,
        error: null,
        durationMs
      )
      attempts.push(attempt)
      logSolveAttempt(solveRequestId, params, attempt, candidatesRemaining)

      // Success: return immediately
      return {
        success: true,
        selectedAnchor: bestQuote.anchor,
        selectedRate: bestQuote.quote,
        attempts: attempts,
        finalError: null,
        solveRequestId: solveRequestId
      }

    } catch (err) {
      // Log failed attempt
      durationMs = Date.now() - attemptStartTime
      attempt = createAttempt(
        attemptNumber,
        bestQuote,
        error: err.message,
        durationMs
      )
      attempts.push(attempt)
      logSolveAttempt(solveRequestId, params, attempt, candidatesRemaining)

      // Mark selected anchor as failed
      if (selectedAnchor) {
        failedAnchorIds.add(selectedAnchor.id)
      }

      finalError = err.message
      // Continue to next iteration
    }
  }

  // All attempts exhausted
  return {
    success: false,
    selectedAnchor: null,
    selectedRate: null,
    attempts: attempts,
    finalError: finalError,
    solveRequestId: solveRequestId
  }
}

/**
 * Helper: Fetch quote from a single anchor
 */
async function fetchAnchorQuote(anchor: Anchor, params: SolveParams) {
  try {
    resolved = await getResolvedAnchorById(anchor.id)
    transferServer = resolved.TRANSFER_SERVER_SEP0024

    if (!transferServer) {
      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        quote: null,
        error: "No transfer server available"
      }
    }

    feeResult = await getSep24Fee({
      transferServer,
      assetCode: params.assetCode,
      assetIssuer: params.assetIssuer,
      amount: params.amount,
      type: params.feeType
    })

    if (!feeResult.ok) {
      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        quote: null,
        error: `Fee fetch failed: ${feeResult.reason}`
      }
    }

    // Construct AnchorRate
    fee = parseFloat(feeResult.fee)
    exchangeRate = 1  // TODO: fetch from market data
    totalReceived = (parseFloat(params.amount) - fee) * exchangeRate

    rate = {
      anchorId: anchor.id,
      anchorName: anchor.name,
      corridorId: params.corridorId,
      fee: fee.toString(),
      feeType: "flat",
      exchangeRate: exchangeRate,
      totalReceived: totalReceived,
      source: "sep24-fee",
      updatedAt: new Date()
    }

    return {
      anchorId: anchor.id,
      anchorName: anchor.name,
      quote: rate,
      error: null
    }

  } catch (err) {
    return {
      anchorId: anchor.id,
      anchorName: anchor.name,
      quote: null,
      error: err instanceof Error ? err.message : "Unknown error"
    }
  }
}
```

### 6.2 Rejection Handler (handleQuoteRejection function)

```typescript
/**
 * Pseudocode for handleQuoteRejection() implementation
 */
async function handleQuoteRejection(
  rejectedAnchorId: string,
  previousAttempts: SolveAttempt[],
  params: SolveParams
): Promise<SolveResult> {

  solveRequestId = generateRequestId()

  // Step 1: Create rejection attempt
  rejectionAttempt = {
    attemptNumber: previousAttempts.length + 1,  // = 2
    selectedAnchorId: rejectedAnchorId,
    selectedAnchorName: "unknown",
    quote: null,
    error: "Quote rejected by anchor",
    timestamp: now()
  }

  // Step 2: Build failed set (include rejection + previous failures)
  failedAnchorIds = new Set()
  failedAnchorIds.add(rejectedAnchorId)

  for (attempt of previousAttempts) {
    if (attempt.error !== null) {
      failedAnchorIds.add(attempt.selectedAnchorId)
    }
  }

  // Step 3: Get remaining candidates
  allAnchors = getAnchorsByCorridorId(params.corridorId)
  candidateAnchors = allAnchors.filter(a => 
    !failedAnchorIds.has(a.id)
  )

  // No candidates left: fail early
  if (candidateAnchors.length === 0) {
    return {
      success: false,
      selectedAnchor: null,
      selectedRate: null,
      attempts: [...previousAttempts, rejectionAttempt],
      finalError: "No remaining anchors after rejection",
      solveRequestId: solveRequestId
    }
  }

  // Step 4: Enforce max attempts
  successfulAttempts = previousAttempts
    .filter(a => a.error === null)
    .length

  // If 2+ previous successes, we can't try again
  if (successfulAttempts >= 2) {
    return {
      success: false,
      selectedAnchor: null,
      selectedRate: null,
      attempts: [...previousAttempts, rejectionAttempt],
      finalError: "Max fallback attempts exhausted (2 fallbacks allowed)",
      solveRequestId: solveRequestId
    }
  }

  // Step 5: Fetch quotes from remaining candidates in parallel
  quotePromises = candidateAnchors.map(anchor => 
    fetchAnchorQuote(anchor, params)
  )
  quoteResults = await Promise.all(quotePromises)

  // Filter to valid quotes
  validQuotes = quoteResults.filter(r => r.quote !== null)

  // No valid fallback quotes
  if (validQuotes.length === 0) {
    return {
      success: false,
      selectedAnchor: null,
      selectedRate: null,
      attempts: [...previousAttempts, rejectionAttempt],
      finalError: "No valid quotes from remaining anchors",
      solveRequestId: solveRequestId
    }
  }

  // Step 6: Select best from remaining
  validQuotes.sort((a, b) => 
    b.quote.totalReceived - a.quote.totalReceived
  )
  bestFromRemaining = validQuotes[0]

  // Step 7: Create fallback attempt
  fallbackAttempt = {
    attemptNumber: previousAttempts.length + 2,  // = 3
    selectedAnchorId: bestFromRemaining.anchorId,
    selectedAnchorName: bestFromRemaining.anchorName,
    quote: bestFromRemaining.quote,
    error: null,
    timestamp: now(),
    durationMs: elapsed
  }

  // Step 8: Log both attempts
  logSolveAttempt(solveRequestId, params, rejectionAttempt, remaining)
  logSolveAttempt(solveRequestId, params, fallbackAttempt, remaining - 1)

  // Step 9: Return combined result
  return {
    success: true,
    selectedAnchor: await getResolvedAnchorById(bestFromRemaining.anchorId),
    selectedRate: bestFromRemaining.quote,
    attempts: [
      ...previousAttempts,
      rejectionAttempt,
      fallbackAttempt
    ],
    finalError: null,
    solveRequestId: solveRequestId
  }
}
```

---

## 7. State Management Strategy

### 7.1 State Entities and Lifecycle

```
solveRequestId (String)
├─ Immutable once generated
├─ Unique per solve() call
├─ Shared across solve() and handleQuoteRejection()
├─ Used for log correlation
└─ Format: "req-<uuid>"

attempts (SolveAttempt[])
├─ Chronologically ordered
├─ Immutable (appended only, never mutated)
├─ Length 1-3 depending on flow:
│  ├─ [attempt1] on initial success
│  ├─ [attempt1, attempt2, attempt3] on rejection + fallback
│  └─ [attempt1, rejAttempt] on exhaustion
├─ Thread-safe (passed as parameter, not shared state)
└─ Serializable to JSON

failedAnchorIds (Set<string>)
├─ Local to solve() function
├─ Tracks anchors to exclude from fallback
├─ Built by:
│  ├─ Adding rejected anchor in handleQuoteRejection
│  ├─ Adding anchors with error !== null from previous attempts
├─ Used for candidate filtering: allAnchors.filter(a => !failedIds.has(a.id))
└─ Represents current exclusion set

selectedAnchor (ResolvedAnchor | null)
├─ Updated as each attempt completes
├─ Null on failure
├─ Set to best quote's anchor on success
├─ Final value returned in SolveResult

selectedRate (AnchorRate | null)
├─ Updated as each attempt completes
├─ Null on failure
├─ Set to best quote on success
├─ Final value returned in SolveResult
```

### 7.2 Attempt Numbering Logic

```
Attempt numbering is deterministic and sequential:

Normal flow (1 success):
  ┌─ solve() attempt 1 → success → return
  └─ attempts=[attempt1]

Rejection + fallback flow (2 successes):
  ┌─ solve() attempt 1 → success
  ├─ [External: Quote rejected]
  └─ handleQuoteRejection()
     ├─ Create rejectionAttempt with attemptNumber = len(prev) + 1 = 2
     ├─ Fetch from remaining
     └─ Create fallbackAttempt with attemptNumber = len(prev) + 2 = 3
     └─ return attempts=[attempt1, rejectionAttempt, fallbackAttempt]

All attempts exhausted flow:
  ┌─ solve() attempt 1 → fail → continue
  ├─ solve() attempt 2 → fail → continue
  ├─ solve() attempt 3 → fail → break
  └─ attempts=[attempt1, attempt2, attempt3]

Mixed flow (1 success, then rejection, no fallback):
  ┌─ solve() attempt 1 → success
  ├─ [External: Quote rejected]
  └─ handleQuoteRejection()
     ├─ Create rejectionAttempt with attemptNumber = 2
     ├─ No remaining candidates
     └─ return attempts=[attempt1, rejectionAttempt]
```

---

## 8. Correctness Properties

A property is a universal characteristic that should hold true across all valid executions. In the fallback anchor resolution system, correctness properties ensure the system maintains invariants about attempt numbering, candidate exhaustion, and data integrity.

### Property 1: Attempt Monotonicity

**Universally**: For any solve flow, attempt numbers strictly increase from 1 to N (where N ≤ 3), and no attempt number is skipped.

**Validates**: Requirements 4.2, 8.5

### Property 2: Candidate Exclusion Correctness

**Universally**: For any fallback attempt, all anchors that appear in previousAttempts with error !== null are excluded from candidate filtering.

**Validates**: Requirement 9

### Property 3: Best Quote Selection

**Universally**: For any set of valid quotes (where error === null), the selected quote has the maximum totalReceived value.

**Validates**: Requirement 11

### Property 4: Serialization Round-Trip

**Universally**: For any SolveResult and SolveAttempt, JSON serialization followed by deserialization produces an equivalent object.

**Validates**: Requirement 12

### Property 5: Attempt History Completeness

**Universally**: For any solve flow, the attempts array contains all executed attempts in chronological order with no gaps or mutations.

**Validates**: Requirement 8

### Property 6: Maximum Attempt Enforcement

**Universally**: For any solve flow, the number of attempts never exceeds 3.

**Validates**: Requirement 4

### Property 7: Candidate Count Invariant

**Universally**: For any attempt, candidatesRemaining ≤ total anchors for the corridor.

**Validates**: Requirement 6

---

## 9. Error Handling


```
Error Type         Where          Propagation       Recovery
─────────────────  ────────────────────────────────────────────
No candidates      solve()        caught, logged    exit with error
No anchors found   solve()        caught, logged    exit with error
Fetch error        Promise.all()  per-anchor,logged skip anchor
No valid quotes    solve()        caught, logged    try next attempt
Rejection          external       handled           attempt fallback
Max attempts       solve()        exit loop         return failure
Exhaustion         solve()        exit loop         return failure
No fallback quotes handleRejection handled           return failure
```

### 8.2 Error Message Taxonomy

```
ERROR_NO_ANCHORS_AVAILABLE
├─ Condition: getAnchorsByCorridorId returns empty array
├─ Message: "No anchors available for corridor {corridorId}"
├─ Recoverable: No (infrastructure issue)
├─ User sees: "No service available for this route"
└─ Reputation impact: None (not anchor-specific)

ERROR_ALL_ANCHORS_EXHAUSTED
├─ Condition: All anchors tried, all failed or rejected
├─ Message: "All anchors have been exhausted after rejection attempts"
├─ Recoverable: No (all options exhausted)
├─ User sees: "No anchor could process your request"
└─ Reputation impact: All attempted anchors marked as failed

ERROR_NO_REMAINING_AFTER_REJECTION
├─ Condition: Rejection occurred, no fallback candidates left
├─ Message: "No remaining anchors after rejection"
├─ Recoverable: No (single anchor with no fallback)
├─ User sees: "Selected anchor failed with no alternatives"
└─ Reputation impact: Rejected anchor marked as unreliable

ERROR_NO_VALID_QUOTES
├─ Condition: All anchors returned null/error quotes
├─ Message: "No valid quotes received from any anchor"
├─ Recoverable: Possible (retry later, anchors may recover)
├─ User sees: "All anchors temporarily unavailable"
└─ Reputation impact: Temporary failure, not anchor-specific

ERROR_NO_VALID_FALLBACK_QUOTES
├─ Condition: Rejection occurred, remaining anchors all failed
├─ Message: "No valid quotes from remaining anchors"
├─ Recoverable: Possible (retry later)
├─ User sees: "Fallback anchors all temporarily unavailable"
└─ Reputation impact: Failed anchors marked for monitoring

ERROR_MAX_ATTEMPTS_EXCEEDED
├─ Condition: Rejection after 2+ previous attempts
├─ Message: "Max fallback attempts exhausted (2 fallbacks allowed)"
├─ Recoverable: No (policy limit reached)
├─ User sees: "Maximum retry attempts reached"
└─ Reputation impact: Policy enforcement, not anchor-specific

ANCHOR_SPECIFIC_ERRORS (per-anchor during fetch)
├─ "No transfer server available": SEP-24 not supported
├─ "Fee fetch failed: {reason}": Network or protocol error
├─ Propagated per attempt: attempt.error field
└─ Reputation impact: Failed anchor skipped in fallback
```

### 8.3 Error Handling Flow

```
fetchAnchorQuote() throws
         │
         ▼
    Caught by Promise.all catch handler
         │
         ├─ Per-anchor error: included in quoteResult
         ├─ Logged to SolveAttempt.error
         └─ Anchor skipped (filtered in validQuotes)

solve() detects no valid quotes
         │
         ├─ Set finalError
         ├─ Continue to next attempt (if not final)
         └─ Exit loop on final attempt

handleQuoteRejection() detects no fallback candidates
         │
         ├─ Return failure SolveResult
         ├─ finalError = "No remaining anchors after rejection"
         └─ Preserve rejection attempt in history

handleQuoteRejection() detects max attempts exceeded
         │
         ├─ Return failure SolveResult
         ├─ finalError = "Max fallback attempts exhausted..."
         └─ Preserve all previous attempts in history
```

---

## 10. Logging Architecture

### 10.1 Log Structure

```typescript
interface SolveAttemptLog {
  timestamp: "2025-01-15T12:34:56.789Z",
  solveRequestId: "req-abc123",
  corridorId: "usdc-ngn",
  amount: "100",
  attemptNumber: 1,
  selectedAnchorId: "anchor1",
  selectedAnchorName: "Anchor One",
  success: true,
  durationMs: 245,
  totalAttempts: 3,
  remainingCandidates: 2,
  error: null  // Omitted if null
}
```

### 10.2 Logging Points and Intent

```
Point 1: Initial Solve Success
Location: solve(), after selecting best quote
Intent: Reputation: anchor performed well
Fields: attemptNumber=1, success=true, error=null, durationMs=245
└─ Used by: Reputation system to increase anchor score

Point 2: Rejection Attempt
Location: handleQuoteRejection(), creating rejection attempt
Intent: Audit: anchor explicitly rejected firm quote
Fields: attemptNumber=2, error="Quote rejected by anchor", durationMs=undefined
└─ Used by: Reputation system to flag anchor as unreliable

Point 3: Fallback Success
Location: handleQuoteRejection(), after selecting from remaining
Intent: Reputation: fallback anchor performed well
Fields: attemptNumber=3, success=true, error=null, durationMs=180
└─ Used by: Reputation system to increase fallback anchor score

Point 4: Failure Attempt
Location: solve(), catch handler after error
Intent: Audit: anchor failed to return valid quote
Fields: attemptNumber=1, error="Fee fetch failed: timeout", durationMs=5000
└─ Used by: Reputation system to mark anchor as unreliable
```

### 10.3 Log Correlation

```
All logs for a single solve() call share:
├─ solveRequestId (unique per solve request)
├─ corridorId (constant)
├─ amount (constant)
└─ totalAttempts (constant, always 3)

Example timeline for one user transaction:
  T1: Log attempt 1 with solveRequestId=req-abc123
      └─ success=true, selectedAnchorId=anchor1
  
  T2: [External system uses anchor1's quote, anchor rejects]
  
  T3: Log attempt 2 (rejection) with same solveRequestId
      └─ error="Quote rejected by anchor", selectedAnchorId=anchor1
  
  T4: Log attempt 3 (fallback) with same solveRequestId
      └─ success=true, selectedAnchorId=anchor2

Reputation system can query:
  SELECT * FROM logs WHERE solveRequestId = "req-abc123"
  └─ Returns 3 logs: shows flow from anchor1 rejection to anchor2 success
```

---

## 11. Concurrency Model

### 11.1 Parallel Quote Fetching

```
Architecture: Promise.all() pattern

solve() flow:
  ┌─ Get candidates [anchor1, anchor2, anchor3]
  │
  ├─ Create promises for each:
  │  ├─ fetchAnchorQuote(anchor1) ──┐
  │  ├─ fetchAnchorQuote(anchor2) ──┤ Run concurrently
  │  └─ fetchAnchorQuote(anchor3) ──┘
  │
  ├─ await Promise.all([p1, p2, p3])
  │  └─ Blocks until ALL promises settle (success or error)
  │
  └─ Process results
     ├─ Individual failures do not stop others
     ├─ Return combined result (some success, some fail)
     └─ Select best from valid quotes

Latency impact:
  ├─ Sequential (old): 3 × 500ms = 1500ms
  ├─ Parallel (new): 1 × 500ms = 500ms
  └─ Savings: 1000ms (67% improvement)

Concurrency guarantees:
  ├─ No shared mutable state
  ├─ Each anchor fetch is independent
  ├─ Results combined after all settle
  └─ Thread-safe (JavaScript is single-threaded)
```

### 11.2 Race Conditions and Prevention

```
Potential Issue 1: Mutation of selectedAnchor during fetch
├─ Risk: selectedAnchor updated while Promise.all() in progress
├─ Prevention: selectedAnchor only set after Promise.all() completes
├─ Guarantee: No mutation during concurrent operations

Potential Issue 2: Logging before all fetches complete
├─ Risk: Log emitted with incomplete data
├─ Prevention: logSolveAttempt() called after attempt fully constructed
├─ Guarantee: Each log contains complete attempt state

Potential Issue 3: Duplicate network calls
├─ Risk: Same anchor fetched twice concurrently
├─ Prevention: candidateAnchors already deduplicated; each fetched once
├─ Guarantee: No duplicate requests

Potential Issue 4: selectedRate undefined if best quote lost
├─ Risk: bestQuote selected but lost before creating attempt
├─ Prevention: bestQuote captured locally, used immediately
├─ Guarantee: bestQuote safely captured in attempt object
```

---

## 12. Performance Considerations

### 12.1 Latency Analysis

```
Baseline (single anchor):
├─ getResolvedAnchorById: ~20ms
├─ getSep24Fee request: ~450ms (network)
└─ Total: ~470ms

Initial Solve with 3 anchors (parallel):
├─ getAnchorsByCorridorId: ~5ms
├─ Promise.all([fetch1, fetch2, fetch3]): ~450ms (max of 3)
├─ Selection and logging: ~10ms
└─ Total: ~465ms (almost same as baseline!)

Rejection + Fallback with 2 remaining anchors:
├─ handleQuoteRejection setup: ~5ms
├─ Promise.all([fetch2, fetch3]): ~450ms
├─ Selection and logging: ~10ms
└─ Total: ~465ms

Three-attempt failure scenario:
├─ Attempt 1: ~465ms
├─ Attempt 2: ~465ms
├─ Attempt 3: ~465ms
└─ Total: ~1395ms (3x single attempt, acceptable for critical path)
```

### 12.2 Memory Footprint

```
Per solve() call:
├─ attempts array: 3 × SolveAttempt ~= 3KB
├─ failedAnchorIds set: ~< 1KB
├─ quote objects cached: ~1KB per quote × 3 = 3KB
├─ promise results: ~2KB
└─ Total: ~10KB (negligible)

Per solveRequestId (correlation):
├─ String ID: ~50 bytes
├─ Associated logs: 3 × ~500 bytes = 1.5KB
└─ Total: ~1.6KB per request

Scaling (1M solve requests):
├─ Memory for IDs: 50MB
├─ Memory for logs: 1.5GB
├─ Database storage: ~2GB (indexed by solveRequestId)
└─ Acceptable for long-term retention
```

### 12.3 Throughput and Capacity

```
Single solve() instance:
├─ Sequential attempts: ~465ms each
├─ Concurrent handlers: Can run 1000s of solve() calls
├─ Network pool: Limited by SEP-24 endpoint connections
└─ Estimated: 1000-10000 concurrent solves (hardware dependent)

Failure scenario impact:
├─ 3 full attempts per call: 1395ms per solve
├─ Still non-blocking (returns control immediately)
├─ Logged asynchronously (no blocking on logging)
└─ Acceptable: <2% of request lifecycle

Log ingestion:
├─ 3 logs per solve = 3 logs per request
├─ 1M requests/day = 3M logs/day
├─ ~35 logs/sec (manageable)
└─ Storage: ~1.5GB/day (1MB/sec, typical)
```

---

## 13. Integration Points with Existing Systems

### 13.1 Anchor Resolution Integration

```
System: lib/stellar/anchors.ts

Functions used:
├─ getAnchorsByCorridorId(corridorId: string): Anchor[]
│  └─ Returns all anchors available for corridor
│  └─ Used in: solve() main loop, handleQuoteRejection()
│
├─ getResolvedAnchorById(anchorId: string): Promise<ResolvedAnchor>
│  └─ Fetches SEP-1 stellar.toml and resolves capabilities
│  └─ Used in: quote fetching, final result construction
│
└─ Assumptions:
   ├─ getAnchorsByCorridorId is synchronous, no network
   ├─ getResolvedAnchorById is cached and performant
   └─ ResolvedAnchor includes TRANSFER_SERVER_SEP0024 capability
```

### 13.2 SEP-24 Fee Integration

```
System: lib/stellar/sep24.ts

Function used:
├─ getSep24Fee(params: Sep24FeeParams): Promise<FeeResult>
│  ├─ Input: transferServer, assetCode, assetIssuer, amount, type
│  ├─ Output: { ok: boolean, fee: number | string, reason?: string }
│  └─ Network call to anchor's /fee endpoint
│
└─ Expectations:
   ├─ Returns fee in asset (USDC) or network error
   ├─ May throw or return error (both handled)
   ├─ Called once per anchor per attempt in parallel
   └─ Errors collected and handled gracefully

Integration detail:
├─ fetchAnchorQuote constructs AnchorRate from getSep24Fee result
├─ Fee value: parsed to float for totalReceived calculation
├─ Error case: result.ok === false → quote = null
└─ Allows solve() to rank by totalReceived
```

### 13.3 Logging Integration

```
System: lib/api/logging.ts

Functions used:
├─ generateRequestId(): string
│  └─ Creates unique correlation ID
│  └─ Used to link all attempts in solve flow
│
└─ logStructured(data: Record<string, unknown>): void
   └─ Emits structured log to aggregation system
   └─ Called for each attempt: solve(), handleQuoteRejection()

Integration detail:
├─ logSolveAttempt() calls logStructured with SolveAttemptLog shape
├─ All attempts for same request share solveRequestId
├─ Logs ingested by reputation system for scoring
└─ Enables audit trail for debugging
```

### 13.4 Type Integration

```
System: types/index.ts

Types imported:
├─ Anchor: Base anchor metadata
├─ ResolvedAnchor: Anchor + SEP-1 capabilities
├─ AnchorRate: Quote with fee, exchange rate, total received
├─ Corridor: Route from asset to fiat in country
│
└─ SolveAttempt, SolveResult: NEW types defined in solve.ts
   └─ May be moved to types/index.ts for broader use

Type compatibility:
├─ SolveAttempt.quote is AnchorRate | null ✓
├─ SolveResult.selectedAnchor is ResolvedAnchor | null ✓
├─ SolveResult.selectedRate is AnchorRate | null ✓
└─ All integrations type-safe
```

### 13.5 Router Integration (High-Level)

```
Flow in router/solve.ts:

1. User calls solve(params) with corridor and amount
   └─ params: { corridorId, amount, assetCode, assetIssuer, feeType }

2. solve() returns SolveResult with selectedAnchor and selectedRate
   └─ Router stores result for later use

3. User initiates transaction with selectedRate
   └─ Uses selectedAnchor.TRANSFER_SERVER_SEP0024 for SEP-24 call

4. Quote is rejected or expires
   └─ Router calls handleQuoteRejection(rejectedAnchorId, attempts)

5. handleQuoteRejection() returns new SolveResult
   └─ Router uses new selectedAnchor and selectedRate

6. All attempts logged to reputation system
   └─ Reputation system queries logs by solveRequestId
   └─ Updates anchor scores based on rejection patterns
```

---

## 14. State Diagram: Complete Lifecycle

```
                     ┌─────────────────────────────────┐
                     │ User calls solve(params)         │
                     └────────────────┬──────────────────┘
                                      │
                                      ▼
                     ┌─────────────────────────────────┐
                     │ Initialize:                      │
                     │ - solveRequestId = gen()         │
                     │ - attempts = []                  │
                     │ - failedAnchorIds = {}           │
                     └────────────────┬──────────────────┘
                                      │
                      ┌───────────────┴───────────────┐
                      │ Loop: attemptNumber 1-3       │
                      │                               │
                      ▼                               ▼
         ┌──────────────────────┐   ┌────────────────────────┐
         │ Get candidates       │   │ (No more candidates)   │
         │ ├─ Get all anchors   │   │ ├─ finalError set      │
         │ └─ Filter failed     │   │ └─ break               │
         └──────────┬───────────┘   └────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │ Fetch quotes          │
        │ ├─ Promise.all()      │
        │ └─ Results: success/fail
        └───────┬───────────────┘
                │
        ┌───────┴──────────────┐
        │ Valid quotes exist?  │
        │                      │
        └─No──→ finalError,    │ ─Yes─→ Select best
                continue             │
                                     ▼
                            ┌──────────────────┐
                            │ Log attempt      │
                            │ ├─ success=true  │
                            │ └─ error=null    │
                            └────────┬─────────┘
                                     │
                        ┌────────────┴──────────────┐
                        │ Return SolveResult        │
                        │ ├─ success=true           │
                        │ ├─ selectedAnchor        │
                        │ ├─ selectedRate          │
                        │ ├─ attempts              │
                        │ └─ solveRequestId        │
                        └──────────────────────────┘


              [External: User uses quote]
                        │
                        ▼
              [Quote rejected/expires]
                        │
                        ▼
         ┌──────────────────────────────────┐
         │ Call handleQuoteRejection(        │
         │   rejectedAnchorId,              │
         │   previousAttempts,              │
         │   params                         │
         │ )                                │
         └──────────────┬───────────────────┘
                        │
        ┌───────────────┴──────────────────┐
        │ Create rejection attempt         │
        │ ├─ attemptNumber = len + 1       │
        │ ├─ error="Quote rejected..."     │
        │ └─ quote=null                    │
        └───────────────┬──────────────────┘
                        │
        ┌───────────────┴──────────────────┐
        │ Build failed set                 │
        │ ├─ Add rejected anchor           │
        │ └─ Add previous failures         │
        └───────────────┬──────────────────┘
                        │
        ┌───────────────┴──────────────────┐
        │ Get remaining candidates         │
        │ ├─ Filter by failed set          │
        │ └─ Check if empty                │
        └───────┬───────────────────────────┘
                │
        ┌───────┴──────────────────┐
        │ Candidates exist?        │
        │                          │
        └─No──→ Error: "No remaining"
                Return failure          ─Yes─→ Check attempts
                                              │
                                              ▼
                                        ┌──────────────────┐
                                        │ successfulAttempts >= 2?
                                        │                  │
                        ┌───────────────┴─────────────┐    │
                        │                             │    │
                     Yes│ (Error: "Max attempts")  No │   │
                        │ Return failure             │   │
                        │                            │   │
                        └─────────────────────────┬──┘   │
                                                 │       │
                                                 │   ┌───┘
                                                 │   │
                                                 │   ▼
                                                 │ ┌────────────────────┐
                                                 │ │ Fetch from         │
                                                 │ │ remaining in       │
                                                 │ │ parallel           │
                                                 │ └────────┬───────────┘
                                                 │          │
                                                 │   ┌──────┴──────────┐
                                                 │   │ Valid quotes?   │
                                                 │   │                 │
                                                 │   └─No──→ Error,    │
                                                 │           Return    │
                                                 │           failure   │
                                                 │                │
                                                 │            ┌──┴────────┐
                                                 │            │ Yes:      │
                                                 │            │ Select    │
                                                 │            │ best      │
                                                 │            └──────┬────┘
                                                 │                   │
                                                 │        ┌──────────┴──────────┐
                                                 │        │ Create fallback     │
                                                 │        │ attempt             │
                                                 │        │ ├─ attemptNumber=3  │
                                                 │        │ ├─ error=null       │
                                                 │        │ └─ quote=best       │
                                                 │        └──────────┬──────────┘
                                                 │                   │
                                                 │        ┌──────────┴──────────┐
                                                 │        │ Log both attempts   │
                                                 │        │ ├─ rejection        │
                                                 │        │ └─ fallback         │
                                                 │        └──────────┬──────────┘
                                                 │                   │
                                                 │        ┌──────────┴──────────┐
                                                 │        │ Return SolveResult  │
                                                 │        │ ├─ success=true     │
                                                 │        │ ├─ selectedAnchor   │
                                                 │        │ ├─ selectedRate     │
                                                 │        │ ├─ attempts=[...    │
                                                 │        │ │   attempt1,       │
                                                 │        │ │   rejection,      │
                                                 │        │ │   fallback]       │
                                                 │        │ └─ solveRequestId   │
                                                 │        └────────────────────┘
                                                 │
                        ┌────────────────────────┘
                        │
                        ▼
         ┌──────────────────────────────────┐
         │ End of lifecycle                 │
         │ (All attempts logged)            │
         │ (Results cached)                 │
         │ (Reputation system consumes)     │
         └──────────────────────────────────┘
```

---

## 14. Appendix: Testing Strategy Summary

Based on the requirements, the following test categories are recommended:

### 14.1 Unit Tests (Example-Based)

```
- solve() returns correct SolveResult structure
- Highest totalReceived selected correctly
- handleQuoteRejection filters failed anchors
- Attempt numbers increment correctly (1, 2, 3)
- Timestamps recorded in ISO 8601 format
- durationMs >= 0
- solveRequestId is non-empty unique string
- finalError is clear and actionable
```

### 14.2 Integration Tests

```
- Full solve() flow with mocked anchors
- Rejection path with fallback
- No candidates remaining path
- Max attempts exceeded path
- All anchors exhausted path
- Log integration with logStructured()
```

### 14.3 Property-Based Tests (Recommended)

```
Property 1: Attempt Numbering Monotonicity
- For any attempt sequence, attemptNumber increases: 1 → 2 → 3
- Validates: Requirement 4

Property 2: Candidate Exclusion Correctness
- For any failed anchor in previousAttempts, it is excluded from fallback candidates
- Validates: Requirement 9

Property 3: Best Quote Selection
- For any set of valid quotes, selected quote has max totalReceived
- Validates: Requirement 11

Property 4: Serialization Round-Trip
- For any SolveResult, JSON serialization then deserialization preserves data
- Validates: Requirement 12

Property 5: Attempt History Completeness
- For any solve flow, attempts array includes all executed attempts in order
- Validates: Requirement 8

Property 6: Max Attempt Enforcement
- For any solve flow, never more than 3 attempts
- Validates: Requirement 4

Property 7: Candidate Count Invariant
- For any attempt, candidatesRemaining <= total anchors for corridor
- Validates: Requirement 6
```

---

## 15. Testing Strategy

### Unit Tests (Example-Based)

- `solve()` returns correct `SolveResult` structure
- Highest `totalReceived` is consistently selected
- `handleQuoteRejection()` correctly filters failed anchors
- Attempt numbers increment correctly (1 → 2 → 3)
- Timestamps are recorded in ISO 8601 format
- `durationMs` is a non-negative number
- `solveRequestId` is unique and non-empty
- Error messages are clear and actionable
- Failed anchors are not re-attempted in fallback

### Integration Tests

- Full `solve()` flow with mocked anchor responses
- Rejection path with successful fallback
- No candidates remaining path returns appropriate error
- Max attempts exceeded path returns failure
- All anchors exhausted scenario
- Log integration with `logStructured()` function
- Parallel quote fetching completes correctly

### Property-Based Tests

**Property 1: Attempt Monotonicity**
- For any attempt sequence, `attemptNumber` strictly increases: 1 → 2 → 3
- Validates: Requirement 4

**Property 2: Candidate Exclusion**
- For any failed anchor in `previousAttempts`, it is excluded from fallback
- Validates: Requirement 9

**Property 3: Best Quote Selection**
- For any set of valid quotes, selected quote has max `totalReceived`
- Validates: Requirement 11

**Property 4: Serialization Round-Trip**
- JSON serialization/deserialization preserves `SolveResult` data
- Validates: Requirement 12

**Property 5: Attempt History**
- For any flow, `attempts` array includes all executed attempts in order
- Validates: Requirement 8

**Property 6: Maximum Attempts**
- For any flow, never more than 3 attempts executed
- Validates: Requirement 4

**Property 7: Candidate Count**
- For any attempt, `candidatesRemaining ≤ total anchors` for corridor
- Validates: Requirement 6

---

## 16. Summary and Key Design Decisions

### Key Design Decisions

1. **Loop-based retry (not recursion)**: Simpler, prevents stack overflow, easier to track state
2. **Parallel quote fetching**: Reduces latency from 3x to 1x single fetch
3. **Immutable attempts array**: Easier to reason about, supports audit trail
4. **Separate rejection handler**: Clear separation of concerns, easier to test
5. **Deterministic selection**: Always select highest totalReceived (no tie-breaking)
6. **Comprehensive logging**: Enables reputation scoring and auditing
7. **Early exit on success**: Don't retry if already have valid quote
8. **Failed anchor tracking**: Prevents retrying same failing anchors

### Success Criteria

- [x] Max 3 total attempts enforced
- [x] Unified UX (caller sees single result)
- [x] Complete attempt history preserved
- [x] All attempts logged for reputation
- [x] Deterministic quote selection
- [x] Parallel fetching for performance
- [x] Clear error messages
- [x] Exhaustion detection
- [x] Failed anchor exclusion
- [x] Type-safe implementation

