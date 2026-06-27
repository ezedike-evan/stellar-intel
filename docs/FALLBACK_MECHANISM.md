# Anchor Quote Fallback Mechanism

## Overview

This document describes the fallback re-solve mechanism implemented in `lib/router/solve.ts` to handle anchor quote rejection, expiration, or failure. When the initially selected anchor's quote is rejected or expires, the system automatically attempts to solve with remaining candidate anchors, ensuring a seamless user experience.

## Requirements Met

✅ Rejection triggers automatic single re-solve  
✅ User sees one unified UX flow (not multiple attempts)  
✅ Both initial and fallback attempts logged for reputation tracking  
✅ Max 2 fallback attempts enforced (1 initial + 2 retries = 3 total)  
✅ Quote rejection handled gracefully  

## Architecture

### Core Functions

#### `solve(params)`
Main entry point for anchor selection and quote resolution.

**Parameters:**
```typescript
{
  corridorId: string          // e.g., 'usdc-ngn'
  amount: string              // Amount in asset (e.g., '100' USDC)
  assetCode: string           // e.g., 'USDC'
  assetIssuer: string         // e.g., 'GA5Z...'
  feeType: string             // e.g., 'external' (SEP-24 fee type)
}
```

**Returns:**
```typescript
SolveResult {
  success: boolean
  selectedAnchor: ResolvedAnchor | null
  selectedRate: AnchorRate | null
  attempts: SolveAttempt[]      // Complete attempt history
  finalError: string | null
  solveRequestId: string        // UUID for log correlation
}
```

**Algorithm:**
1. Generate unique `solveRequestId` for log correlation
2. Loop up to 3 times (maxAttempts):
   - Get all anchors for the corridor
   - Filter out failed anchors from previous attempts
   - Fetch quotes from remaining candidates in parallel
   - Select best quote (highest `totalReceived`)
   - Log attempt with duration and candidate count
   - Return success or continue to next attempt
3. Return final result with complete attempt history

#### `handleQuoteRejection(rejectedAnchorId, previousAttempts, params)`
Handles quote rejection by re-solving with remaining candidates.

**Called when:**
- Anchor rejects firm quote (explicit error)
- Quote expires before confirmation
- Network timeout on quote confirmation
- Any other quote validation failure

**Returns:**
```typescript
SolveResult {
  // Same as solve(), with attempts array including:
  // 1. Previous attempts
  // 2. Rejection event (attemptNumber = previousAttempts.length + 1)
  // 3. Fallback attempt (attemptNumber = previousAttempts.length + 2)
}
```

**Fallback Logic:**
1. Mark rejected anchor as failed
2. Identify and exclude all previously failed anchors
3. Check if max 2 fallback attempts exhausted
4. Fetch quotes from remaining candidates
5. Select best quote from fallback candidates
6. Log fallback attempt with candidate count

### Data Structures

#### SolveAttempt
Represents a single attempt in the solve flow.

```typescript
interface SolveAttempt {
  attemptNumber: number           // 1, 2, or 3
  selectedAnchorId: string        // Anchor tried
  selectedAnchorName: string      // Human-readable name
  quote: AnchorRate | null        // Quote if successful
  error: string | null            // Error if failed
  timestamp: string               // ISO 8601 timestamp
  durationMs?: number             // Attempt duration in milliseconds
}
```

#### SolveResult
Complete result including attempt history for reputation tracking.

```typescript
interface SolveResult {
  success: boolean
  selectedAnchor: ResolvedAnchor | null
  selectedRate: AnchorRate | null
  attempts: SolveAttempt[]        // ALL attempts (initial + fallbacks)
  finalError: string | null       // Terminal error message if failed
  solveRequestId?: string         // UUID for correlation
}
```

## Attempt Tracking & Limits

### Attempt Numbering
- **Attempt 1:** Initial solve (all candidates)
- **Attempt 2:** First fallback (after rejection/error)
- **Attempt 3:** Second fallback (after second rejection/error)
- **Stop:** No more attempts after attempt 3

### Candidate Exclusion
Once an anchor fails (for any reason), it's excluded from all subsequent attempts:

```
Initial (Attempt 1):      [Anchor A, Anchor B, Anchor C]
Failed: Anchor A
Fallback 1 (Attempt 2):   [Anchor B, Anchor C]
Failed: Anchor B
Fallback 2 (Attempt 3):   [Anchor C]
Failed: Anchor C
Result: All anchors exhausted → Failure
```

## Unified UX Flow

The mechanism provides a **single unified response** to the user while internally tracking all attempts:

### User Perspective
```
1. User initiates withdrawal
2. System selects best anchor and quote
3. User proceeds with KYC/transfer
4. [If rejection occurs]
   System automatically finds next best anchor
   User sees seamless transition (no multiple UX flows)
```

### Internal Tracking
```
SolveResult.attempts = [
  { attemptNumber: 1, error: null, quote: {...} },    // Initial success
  { attemptNumber: 2, error: "Quote rejected", ... }, // Rejection event
  { attemptNumber: 3, error: null, quote: {...} }     // Fallback success
]
```

The UX layer should **only show the final successful result**, but the complete attempt history is available for:
- Logging and monitoring
- Anchor reputation scoring
- Debugging and diagnostics

## Logging for Reputation Tracking

### Log Structure
Each attempt is logged with structured data for ingestion into log aggregation systems:

```typescript
{
  timestamp: "2026-06-27T14:30:45.123Z",
  solveRequestId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  corridorId: "usdc-ngn",
  amount: "100",
  attemptNumber: 1,
  selectedAnchorId: "moneygram",
  selectedAnchorName: "MoneyGram",
  success: true,
  durationMs: 234,
  totalAttempts: 3,
  remainingCandidates: 2
}
```

### Key Fields for Reputation
- `selectedAnchorId`: Which anchor was tried
- `success`: Whether attempt succeeded
- `error`: Why it failed (if applicable)
- `durationMs`: Performance metric
- `remainingCandidates`: How many alternatives were available
- `solveRequestId`: Correlate all attempts for a single user request

### Usage Examples
1. **Anchor Reliability:** Track success rate per anchor
2. **Performance Monitoring:** Identify slow anchors (high durationMs)
3. **Fallback Effectiveness:** Measure how often fallback succeeds
4. **Candidate Pool Health:** Monitor when anchors run out

## Error Handling

### Terminal Failures
The system returns failure when:

1. **No anchors available**
   ```
   finalError: "No anchors available for corridor usdc-ngn"
   ```

2. **All anchors exhausted**
   ```
   finalError: "All anchors have been exhausted after rejection attempts"
   ```

3. **Max fallback attempts exceeded**
   ```
   finalError: "Max fallback attempts exhausted (2 fallbacks allowed)"
   ```

4. **No valid quotes**
   ```
   finalError: "No valid quotes received from any anchor"
   ```

### Per-Attempt Errors
Individual anchor failures don't terminate the flow:

- Fee fetch failed (anchor unreachable)
- Missing transfer server (configuration issue)
- Network timeout (transient error)
- Invalid response (protocol violation)

These are recorded in `attempts[i].error` and trigger fallback.

## Edge Cases Handled

### Network Errors vs. Explicit Rejection
- **Network errors:** Anchor treated as failed, fallback triggered
- **Explicit rejection:** Same handling (failure → fallback)
- **Quote expiration:** Treated as rejection event

### Quote Expiration Mid-Attempt
If a quote expires while processing:
1. Marked as failed attempt
2. Fallback triggered
3. Remaining candidates queried for fresh quotes

### Multiple Consecutive Failures
If anchors keep failing:
```
Attempt 1: Anchor A - network error ❌
Attempt 2: Anchor B - quote rejected ❌
Attempt 3: Anchor C - fee fetch failed ❌
Result: No anchors remaining → Failure
```

### Single Anchor Corridor
If only one anchor serves a corridor:
```
Attempt 1: Anchor A - fee fetch failed ❌
Attempt 2: No candidates remaining
Result: Failure (no fallback possible)
```

## Integration Points

### From ExecuteDrawer
When quote is rejected during execution:

```typescript
const result = await handleQuoteRejection(
  rejectedAnchorId,
  previousSolveResult.attempts,
  {
    corridorId: route.corridorId,
    amount: route.amount,
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    feeType: 'external'
  }
)

if (result.success) {
  // Use result.selectedAnchor and result.selectedRate
  // User doesn't see multiple attempts
} else {
  // Show final error to user
  // Log attempt history for debugging
}
```

### Logging Integration
Attempts are logged automatically via `logStructured()`:

```typescript
// Each attempt logs structured data
logSolveAttempt(solveRequestId, params, attempt, remainingCandidates)
```

Monitor via log aggregation system (CloudWatch, Datadog, ELK, etc.)

## Testing

### Test Coverage
Located in `tests/router-fallback.spec.ts`:

1. **Initial Selection:**
   - ✓ Best quote selection
   - ✓ Attempt logging with duration
   - ✓ Error handling (no anchors, fee failures)
   - ✓ Missing transfer server

2. **Fallback Flow:**
   - ✓ Rejection triggers re-solve
   - ✓ Unified UX (single response)
   - ✓ Max 2 fallbacks enforced
   - ✓ All anchors exhausted
   - ✓ Complete attempt history preserved
   - ✓ Failed anchors excluded from fallback
   - ✓ Network errors handled

3. **Edge Cases:**
   - ✓ Network errors in fallback candidates
   - ✓ Unique solveRequestId for correlation

### Running Tests
```bash
npm run test -- tests/router-fallback.spec.ts
```

## Performance Considerations

### Parallel Quote Fetching
Quotes are fetched in parallel (Promise.all) rather than sequentially:
```typescript
const quotePromises = candidateAnchors.map(async anchor => {
  // Fetch quote
})
const quoteResults = await Promise.all(quotePromises)
```

**Impact:** 3 anchors fetched in ~1 parallel request instead of 3 sequential

### Attempt Logging
Logging happens after each attempt (non-blocking):
```typescript
logSolveAttempt(solveRequestId, params, attempt, candidatesRemaining)
```

No waiting for logs; execution continues immediately.

### Memory Usage
Attempt history is preserved but minimal:
- Each attempt: ~400 bytes
- Max attempts: 3
- Total: ~1.2 KB per request

## Future Improvements

1. **Configurable Max Attempts:** Make 3-attempt limit configurable per environment
2. **Anchor Scoring:** Weight anchors by reputation before selection
3. **Rate Stickiness:** Prefer same anchor if quote still valid
4. **Timeout Handling:** Distinguish between network timeout and explicit rejection
5. **Analytics Dashboard:** Real-time monitoring of fallback rates by corridor
6. **Circuit Breaker:** Temporarily disable failing anchors

## Troubleshooting

### Fallback Not Working
- Check: Are there multiple anchors configured for the corridor?
- Verify: `getAnchorsByCorridorId()` returns >1 anchor
- Test: Try with corridor that has 3+ anchors

### Max Attempts Exhausted Immediately
- Check: All anchors throwing errors?
- Verify: SEP-24 endpoints accessible
- Test: Try with working test anchor first

### Attempt History Missing
- Check: Is `handleQuoteRejection()` being called?
- Verify: `previousAttempts` passed with complete history
- Test: Check `solveRequestId` in logs

## References

- SEP-24: Hosted Deposit and Withdrawal
- SEP-38: Anchor Platform Quote API
- `lib/stellar/sep24.ts`: SEP-24 fee fetching
- `lib/router/solve.ts`: Core implementation
- `tests/router-fallback.spec.ts`: Test suite
