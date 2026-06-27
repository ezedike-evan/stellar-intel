# Fallback Re-Solve - Quick Start Guide

## TL;DR

The fallback mechanism automatically retries anchor quote selection if the first anchor rejects or fails, up to 2 additional times (3 total attempts). Users see a single unified response.

## Usage

### Initial Quote Selection
```typescript
import { solve } from '@/lib/router/solve'

const result = await solve({
  corridorId: 'usdc-ngn',
  amount: '100',
  assetCode: 'USDC',
  assetIssuer: 'GA5Z...',
  feeType: 'external'
})

if (result.success) {
  // Use result.selectedAnchor and result.selectedRate
} else {
  // Handle error: result.finalError
}
```

### Handle Quote Rejection
```typescript
import { handleQuoteRejection } from '@/lib/router/solve'

// When anchor rejects quote during execution
const fallbackResult = await handleQuoteRejection(
  rejectedAnchorId,
  initialResult.attempts,  // Pass complete attempt history
  {
    corridorId: 'usdc-ngn',
    amount: '100',
    assetCode: 'USDC',
    assetIssuer: 'GA5Z...',
    feeType: 'external'
  }
)

if (fallbackResult.success) {
  // Continue with fallback anchor
} else {
  // All anchors exhausted: fallbackResult.finalError
}
```

## Key Points

### Attempt Limits
- **Attempt 1:** Initial solve (all candidates)
- **Attempt 2:** First fallback (if rejected)
- **Attempt 3:** Second fallback (if rejected again)
- **Stop:** No more attempts after 3

### Candidate Exclusion
Once an anchor fails, it's never retried:
```
Initial:      [Anchor A, B, C] → Failed: A
Fallback 1:   [Anchor B, C]     ← A excluded
              → Failed: B
Fallback 2:   [Anchor C]        ← A, B excluded
              → Success or final failure
```

### Unified UX
User sees **one response**, but internal tracking captures all attempts:
```typescript
result.attempts = [
  { attemptNumber: 1, error: null, quote: {...} },      // Success
  { attemptNumber: 2, error: "Quote rejected" },        // Rejection
  { attemptNumber: 3, error: null, quote: {...} }       // Fallback success
]
```

### Return Types
```typescript
interface SolveResult {
  success: boolean                  // Overall success
  selectedAnchor: ResolvedAnchor | null
  selectedRate: AnchorRate | null
  attempts: SolveAttempt[]         // ALL attempts (for logging)
  finalError: string | null
  solveRequestId: string           // UUID for log correlation
}

interface SolveAttempt {
  attemptNumber: number            // 1, 2, or 3
  selectedAnchorId: string
  selectedAnchorName: string
  quote: AnchorRate | null
  error: string | null
  timestamp: string
  durationMs?: number
}
```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "No anchors available for corridor X" | Corridor not configured | Add anchors to constants/anchors.ts |
| "All anchors have been exhausted" | All candidates failed | Check anchor server status |
| "Max fallback attempts exhausted" | Already tried 3 times | Give up or show error to user |
| "No valid quotes received" | All anchors returned errors | Verify SEP-24 endpoints |
| "No remaining anchors after rejection" | Only one anchor for corridor | No fallback possible |

## Logging

Each attempt is logged with structured data:
```typescript
{
  "timestamp": "2026-06-27T14:30:45.123Z",
  "solveRequestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "corridorId": "usdc-ngn",
  "amount": "100",
  "attemptNumber": 1,
  "selectedAnchorId": "moneygram",
  "selectedAnchorName": "MoneyGram",
  "success": true,
  "durationMs": 234,
  "totalAttempts": 3,
  "remainingCandidates": 2
}
```

Use `solveRequestId` to correlate all attempts for a single user request.

## Integration Example

```typescript
// In ExecuteDrawer.tsx
async function handleQuoteRejection() {
  try {
    const result = await handleQuoteRejection(
      currentAnchor.id,
      solveResult.attempts,
      solveParams
    )

    if (result.success) {
      // Update state
      setSelectedAnchor(result.selectedAnchor)
      setSelectedRate(result.selectedRate)
      // Continue flow - no multiple dialogs!
    } else {
      // Show error to user
      setError(result.finalError)
      // Log all attempts for debugging
      logAttempts(result.attempts, result.solveRequestId)
    }
  } catch (err) {
    setError('Unexpected error during fallback')
  }
}
```

## Testing

Run tests:
```bash
npm run test -- tests/router-fallback.spec.ts
```

All 15 tests should pass.

## Files

- **Implementation:** `lib/router/solve.ts` (470 lines)
- **Tests:** `tests/router-fallback.spec.ts` (570 lines)
- **Docs:** `docs/FALLBACK_MECHANISM.md` (388 lines)
- **Guide:** `IMPLEMENTATION_FALLBACK.md`

## More Info

For detailed documentation, see:
- `docs/FALLBACK_MECHANISM.md` - Complete reference
- `IMPLEMENTATION_FALLBACK.md` - Implementation summary
- `FALLBACK_IMPLEMENTATION_CHECKLIST.md` - What was done

## Troubleshooting

**Fallback not working:**
- Verify corridor has 3+ anchors configured
- Check `getAnchorsByCorridorId()` returns multiple anchors

**Max attempts hit immediately:**
- Check SEP-24 endpoints are accessible
- Verify anchor configuration in constants/anchors.ts

**Attempt history missing:**
- Ensure `handleQuoteRejection()` is called with `previousAttempts`
- Check `solveRequestId` in logs for correlation

---

For questions, see the full documentation in `docs/FALLBACK_MECHANISM.md`
