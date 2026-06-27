# Fallback Re-Solve Implementation Summary

## What Was Done

Implemented a comprehensive **fallback re-solve mechanism** for anchor quote rejection in stellar-intel v1.2. When an anchor's quote is rejected or expires, the system automatically attempts to resolve with remaining candidate anchors, providing users a seamless experience.

## Key Deliverables

### 1. Core Implementation (`lib/router/solve.ts`)

**Enhanced `solve()` function:**
- Added `solveRequestId` (UUID) for log correlation
- Improved attempt tracking with `durationMs` timing
- Better logging for reputation tracking
- Clear error messages for all failure modes

**New `handleQuoteRejection()` function:**
- Automatically triggered when quote is rejected
- Marks anchor as failed and retries with remaining candidates
- Enforces max 2 fallback attempts (3 total)
- Preserves complete attempt history for reputation tracking
- Returns unified response to user (single flow, no multiple dialogs)

**Logging Integration:**
- Each attempt logged with structured data
- Includes: timestamp, solveRequestId, attempt number, duration, candidates remaining
- Ready for ingestion into log aggregation systems (CloudWatch, Datadog, ELK)

### 2. Complete Test Suite (`tests/router-fallback.spec.ts`)

**15 comprehensive tests covering:**

✅ **Initial Selection (4 tests)**
- Best quote selection among candidates
- Attempt logging with duration metrics
- Error handling (no anchors, fee failures, missing servers)

✅ **Fallback Mechanism (3 tests)**
- No fallback on initial success
- Max 3 total attempts enforced
- Fallback only occurs on rejection/error

✅ **Fallback Flow (6 tests)**
- Rejection triggers automatic re-solve
- Unified UX (user sees single response)
- Max 2 fallbacks enforced
- Candidate exclusion (failed anchors not retried)
- Complete attempt history preservation
- Error when all anchors exhausted

✅ **Edge Cases (2 tests)**
- Network errors in fallback candidates
- Unique solveRequestId for log correlation

**All tests passing:** `npm run test -- tests/router-fallback.spec.ts` ✓

### 3. Documentation (`docs/FALLBACK_MECHANISM.md`)

**Comprehensive 300+ line guide including:**
- Architecture overview and data structures
- Complete function signatures and examples
- Attempt tracking logic and limits
- Unified UX flow explanation
- Logging for reputation systems
- Error handling and edge cases
- Integration points
- Performance considerations
- Troubleshooting guide

## Technical Details

### Attempt Tracking (Max 3 Total)
```
Attempt 1 (Initial):  All candidates        → Best quote selected
                                              ↓
                      [Success] → Return with quote
                      [Failure] → Continue
                                              ↓
Attempt 2 (Fallback): Remaining candidates  → Best quote selected
                                              ↓
                      [Success] → Return with quote
                      [Failure] → Continue
                                              ↓
Attempt 3 (Fallback): Remaining candidates  → Best quote selected
                                              ↓
                      [Success] → Return with quote
                      [Failure] → Return error
```

### Candidate Exclusion
Once an anchor fails (any reason), it's excluded from all subsequent attempts:
```
Initial:     [Anchor A, B, C]
Failed: A    
Fallback 1:  [Anchor B, C]      ← Anchor A excluded
Failed: B    
Fallback 2:  [Anchor C]         ← Anchors A, B excluded
Failed: C    
Result:      All exhausted
```

### Unified UX Response
User sees **single response** regardless of internal retries:
```typescript
{
  success: true,
  selectedAnchor: selectedAnchor,
  selectedRate: bestQuote,
  attempts: [
    { attemptNumber: 1, error: null, quote: {...} },
    { attemptNumber: 2, error: "Quote rejected" },
    { attemptNumber: 3, error: null, quote: {...} }
  ]
}
```

UX layer shows final result; internal logging tracks all attempts for reputation.

### Logging Example
```json
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

## Acceptance Criteria - Met ✓

| Requirement | Status | Details |
|-----------|--------|---------|
| Rejection triggers automatic re-solve | ✓ | `handleQuoteRejection()` called on rejection → re-solves with remaining candidates |
| Max 2 fallback attempts (3 total) | ✓ | Hardcoded limit with `maxAttempts = 3` in solve loop |
| Initial + fallback attempts logged | ✓ | Each attempt logged via `logSolveAttempt()` with full metadata |
| Unified UX (single flow) | ✓ | Complete attempt history internal; user sees single result |
| Quote rejection handled gracefully | ✓ | Explicit rejection triggers fallback; no crashes or loss of data |
| Candidate exclusion | ✓ | Failed anchors tracked in `failedAnchorIds` Set |
| Error handling | ✓ | All edge cases handled: network errors, missing servers, exhausted candidates |

## How to Use

### From ExecuteDrawer Component
```typescript
import { handleQuoteRejection } from '@/lib/router/solve'

// When anchor rejects quote during execution
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
  // Continue with fallback anchor
  setSelectedAnchor(result.selectedAnchor)
  setSelectedRate(result.selectedRate)
} else {
  // Show error to user
  setError(result.finalError)
  // Log complete attempt history for debugging
  console.log('All attempts exhausted:', result.attempts)
}
```

### From API Route
```typescript
import { solve } from '@/lib/router/solve'

export async function GET(request: NextRequest) {
  const result = await solve({
    corridorId: request.nextUrl.searchParams.get('corridor'),
    amount: request.nextUrl.searchParams.get('amount'),
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    feeType: 'external'
  })

  return NextResponse.json(result)
}
```

## File Changes

### Modified Files
- **lib/router/solve.ts**: Enhanced with fallback logic, logging, and improved attempt tracking
- **tests/router-fallback.spec.ts**: 15 comprehensive tests for fallback mechanism

### New Files
- **docs/FALLBACK_MECHANISM.md**: Complete implementation guide (300+ lines)
- **IMPLEMENTATION_FALLBACK.md**: This summary document

## Testing

Run all fallback tests:
```bash
npm run test -- tests/router-fallback.spec.ts
```

Run with coverage:
```bash
npm run test:coverage -- tests/router-fallback.spec.ts
```

All 15 tests passing ✓

## Next Steps (Recommendations)

1. **Integration Testing**: Test with ExecuteDrawer component to verify UX flow
2. **Monitoring Dashboard**: Set up dashboards using `solveRequestId` for correlation
3. **Anchor Reputation System**: Use attempt logs to score anchor reliability
4. **Load Testing**: Verify parallel quote fetching performance with 10+ anchors
5. **Configuration**: Make max attempts configurable per environment if needed

## Files Reference

- **Core Implementation**: `/lib/router/solve.ts` (230+ lines)
- **Test Suite**: `/tests/router-fallback.spec.ts` (480+ lines)
- **Documentation**: `/docs/FALLBACK_MECHANISM.md` (300+ lines)

## Questions?

Refer to `docs/FALLBACK_MECHANISM.md` for:
- Detailed architecture
- Data structure definitions
- Error handling patterns
- Edge cases
- Performance considerations
- Troubleshooting guide
