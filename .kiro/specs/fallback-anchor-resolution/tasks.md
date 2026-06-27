# Implementation Plan: Fallback Anchor Resolution

## Overview

This implementation plan breaks down the fallback anchor resolution feature into discrete, testable coding tasks. The feature is already partially implemented in `lib/router/solve.ts` and `handleQuoteRejection()`, but requires comprehensive testing and validation. The tasks focus on:

1. **Verification of core implementation** against design specifications
2. **Comprehensive unit testing** for initial solve and rejection flows
3. **Property-based testing** for the seven correctness properties defined in the design
4. **Integration testing** with mocked external dependencies
5. **Edge case testing** for boundary conditions and error scenarios

The solve algorithm uses:
- Maximum 3 total attempts (1 initial + 2 fallbacks)
- Parallel quote fetching via Promise.all()
- Best quote selection by totalReceived (highest first)
- Attempt history tracking for reputation scoring
- Unique solveRequestId for log correlation

## Tasks

### Phase 1: Core Implementation Verification and Type Definition

- [ ] 1. Verify and refine SolveAttempt type definition
  - Validate interface matches design specification
  - Ensure attemptNumber is strictly 1 | 2 | 3 (not generic number)
  - Verify timestamp is ISO 8601 string format
  - Check durationMs is optional and in milliseconds
  - Validate quote is AnchorRate | null (never undefined)
  - _Requirements: 6.1, 12.1, 12.3_

- [ ] 2. Verify and refine SolveResult type definition
  - Validate success field is boolean
  - Verify selectedAnchor and selectedRate can be null
  - Ensure attempts array is complete and immutable
  - Check solveRequestId is present and unique
  - Validate all fields serialize to JSON without circular references
  - _Requirements: 12.1, 12.2_

- [ ] 3. Verify solve() implementation against algorithm specification
  - Check max attempt loop is exactly 3 iterations
  - Verify failedAnchorIds set is initialized and updated correctly
  - Validate candidate filtering: allAnchors.filter(a => !failedAnchorIds.has(a.id))
  - Ensure Promise.all() is used for parallel quote fetching
  - Verify best quote selection sorts by totalReceived descending
  - Check early exit on success (return immediately)
  - Validate error messages match specification exactly
  - _Requirements: 1.1, 1.2, 1.3, 13.1, 13.2_

- [ ] 4. Verify handleQuoteRejection() implementation
  - Check rejection attempt has attemptNumber = previousAttempts.length + 1
  - Verify failed anchors are accumulated from previous attempts
  - Validate candidate filtering excludes rejected anchor and failed anchors
  - Ensure no candidates causes immediate failure return
  - Check max 3 total attempts enforcement (successfulAttempts >= 2 returns error)
  - Verify parallel quote fetching from remaining candidates
  - Check fallback attempt has error = null on success
  - _Requirements: 2.2, 2.3, 3.1, 3.2, 4.1, 4.2_

- [ ] 5. Verify logSolveAttempt() function implementation
  - Check function accepts solveRequestId, params, attempt, candidatesRemaining
  - Verify structured log includes all required fields
  - Validate timestamp is recorded in ISO 8601 format
  - Check durationMs is captured correctly
  - Verify candidatesRemaining reflects count excluding selected anchor
  - Ensure error field is included when attempt.error !== null
  - _Requirements: 6.1, 6.2, 6.3_

### Phase 2: Unit Tests for solve() - Initial Solve Success Path

- [ ] 6. Write unit test: solve() returns successful result on first attempt
  - Mock getAnchorsByCorridorId to return 3 anchors
  - Mock getSep24Fee to return valid quotes for all anchors
  - Verify returned SolveResult has success = true
  - Verify attempts array has exactly 1 entry with attemptNumber = 1
  - Verify selectedAnchor is populated with best quote anchor
  - Verify selectedRate is populated with best quote
  - Verify finalError is null
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 7. Write unit test: solve() selects best quote by totalReceived
  - Mock 3 anchors with different totalReceived values (100, 95, 98)
  - Verify selected anchor has totalReceived = 100 (highest)
  - Verify quote contains correct fee and exchangeRate
  - Verify totalReceived is calculated as (amount - fee) * exchangeRate
  - _Requirements: 11.1, 11.2, 11.4_

- [ ] 8. Write unit test: solve() measures and logs attempt duration
  - Mock quote fetches with controlled timing
  - Verify durationMs is present in logged attempt
  - Verify durationMs is >= actual fetch time
  - Verify timestamp is in ISO 8601 format
  - _Requirements: 1.5, 6.4, 6.5_

- [ ] 9. Write unit test: solve() assigns unique solveRequestId
  - Call solve() multiple times
  - Verify each SolveResult has unique solveRequestId
  - Verify solveRequestId is string in correct format
  - Verify solveRequestId is included in logged attempts
  - _Requirements: 1.6, 6.2, 14.3_

- [ ] 10. Write unit test: solve() fetches quotes in parallel using Promise.all()
  - Mock getSep24Fee to track concurrent invocations
  - Verify all quote fetches are initiated before any complete
  - Verify Promise.all is used (not sequential awaits)
  - _Requirements: 13.1, 13.2, 13.3_

- [ ] 11. Write unit test: solve() handles empty anchor list
  - Mock getAnchorsByCorridorId to return empty array
  - Verify returned SolveResult has success = false
  - Verify finalError = "No anchors available for corridor {corridorId}"
  - Verify attempts array is empty
  - _Requirements: 10.1_

- [ ] 12. Write unit test: solve() handles no valid quotes from any anchor
  - Mock getAnchorsByCorridorId to return 3 anchors
  - Mock getSep24Fee to return error for all anchors
  - Verify returned SolveResult has success = false
  - Verify finalError = "No valid quotes received from any anchor"
  - _Requirements: 3.5, 10.2_

### Phase 3: Unit Tests for solve() - Fallback Path

- [ ] 13. Write unit test: solve() marks failed anchor and retries
  - Mock first attempt to fail, second to succeed
  - Verify failedAnchorIds contains first failed anchor
  - Verify second attempt filters out first anchor
  - Verify attempts array has 2 entries (attempt 1 error, attempt 2 success)
  - Verify second attempt has attemptNumber = 2
  - _Requirements: 9.1, 9.2, 3.2_

- [ ] 14. Write unit test: solve() enforces maximum 3 attempts
  - Create scenario where all 3 attempts would be needed
  - Verify loop runs exactly 3 times maximum
  - Verify fourth iteration never occurs
  - Verify fourth attempt never has attemptNumber = 4
  - _Requirements: 4.1, 4.2_

- [ ] 15. Write unit test: solve() returns error on exhaustion
  - Mock 3 anchors, all fail sequentially
  - Verify returned SolveResult has success = false
  - Verify finalError = "All anchors have been exhausted after rejection attempts"
  - Verify attempts array contains all 3 failed attempts
  - _Requirements: 5.1, 5.2_

- [ ] 16. Write unit test: solve() handles partial failure (some anchors fail, others succeed)
  - Mock 3 anchors where first 2 fail, third succeeds
  - Verify solve() continues through failed anchors
  - Verify final result is from third anchor
  - Verify attempts array shows attempt 1 (fail), attempt 2 (fail), attempt 3 (success)
  - _Requirements: 3.2, 5.3_

### Phase 4: Unit Tests for handleQuoteRejection()

- [ ] 17. Write unit test: handleQuoteRejection() creates rejection attempt
  - Call handleQuoteRejection with previousAttempts from successful solve
  - Verify returned attempts array has rejection attempt with attemptNumber = 2
  - Verify rejection attempt has error = "Quote rejected by anchor"
  - Verify rejection attempt has quote = null
  - _Requirements: 2.3, 2.4, 2.5_

- [ ] 18. Write unit test: handleQuoteRejection() selects from remaining candidates
  - Mock handleQuoteRejection with rejection of first anchor
  - Verify remaining 2 anchors are candidates for fallback
  - Verify rejected anchor is not in fallback quote fetches
  - Verify best quote from remaining is selected
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 19. Write unit test: handleQuoteRejection() returns failure on no remaining candidates
  - Mock single anchor scenario with rejection
  - Call handleQuoteRejection
  - Verify returned SolveResult has success = false
  - Verify finalError = "No remaining anchors after rejection"
  - _Requirements: 5.4_

- [ ] 20. Write unit test: handleQuoteRejection() enforces max attempts on successful previous attempts
  - Create scenario with 2 previous successful attempts + rejection
  - Call handleQuoteRejection
  - Verify returned SolveResult has success = false
  - Verify finalError = "Max fallback attempts exhausted (2 fallbacks allowed)"
  - Verify new fallback attempt is NOT created
  - _Requirements: 4.3, 4.5_

- [ ] 21. Write unit test: handleQuoteRejection() logs both rejection and fallback attempts
  - Mock handleQuoteRejection with successful fallback
  - Verify logSolveAttempt is called twice (rejection + fallback)
  - Verify both attempts have same solveRequestId
  - Verify rejection attempt has attemptNumber = 2, fallback has attemptNumber = 3
  - _Requirements: 2.5, 6.2, 14.4_

- [ ] 22. Write unit test: handleQuoteRejection() preserves previous attempts in history
  - Create previousAttempts with attempt1 (successful)
  - Call handleQuoteRejection
  - Verify returned attempts array is [attempt1, rejectionAttempt, fallbackAttempt]
  - Verify attempt1 is unchanged and in position 0
  - _Requirements: 8.1, 8.2_

### Phase 5: Unit Tests for Attempt Numbering and History

- [ ] 23. Write unit test: attempt numbers are strictly 1, 2, or 3
  - Run multiple solve flows: initial success, rejection+fallback, exhaustion
  - Verify all attemptNumber values in all attempts are in {1, 2, 3}
  - Verify no attemptNumber = 0, 4, or any other value
  - _Requirements: 1.1, 4.2_

- [ ] 24. Write unit test: attempts array is chronologically ordered
  - Create solve flow with rejection and fallback
  - Verify attempts[0].attemptNumber = 1
  - Verify attempts[1].attemptNumber = 2
  - Verify attempts[2].attemptNumber = 3
  - Verify timestamps are monotonically increasing (or equal)
  - _Requirements: 8.1, 8.4_

- [ ] 25. Write unit test: candidate count is correctly reported
  - Mock 5 anchors for corridor
  - Verify first attempt reports candidatesRemaining = 4
  - After rejection of first anchor, verify fallback reports candidatesRemaining = 3
  - _Requirements: 6.6_

- [ ] 26. Write unit test: failed anchors are excluded from subsequent attempts
  - Create scenario with specific anchor failing
  - Verify failedAnchorIds set includes failed anchor ID
  - Verify filtered candidateAnchors does NOT include failed anchor
  - Verify no attempt ever selects the failed anchor again
  - _Requirements: 9.2, 9.3, 9.4_

### Phase 6: Integration Tests

- [ ] 27. Write integration test: solve() with mocked Anchor resolution system
  - Mock getAnchorsByCorridorId to return ResolvedAnchor objects with SEP-24
  - Mock getSep24Fee to return realistic AnchorRate data
  - Mock generateRequestId to use predictable IDs
  - Mock logStructured to capture logs
  - Execute full solve flow
  - Verify integration chain works end-to-end
  - _Requirements: 13.1, 13.4_

- [ ] 28. Write integration test: handleQuoteRejection() with full anchor stack
  - Set up complete mocked anchor system
  - Execute initial solve() → get result
  - Execute handleQuoteRejection() with rejection
  - Verify both functions work together
  - Verify attempts history is complete and correct
  - _Requirements: 2.2, 3.1, 3.2_

- [ ] 29. Write integration test: logging correlation via solveRequestId
  - Execute solve() with rejection and fallback
  - Capture all logSolveAttempt calls
  - Verify all logged attempts have identical solveRequestId
  - Verify reputation system can reconstruct flow from logs
  - _Requirements: 6.2, 14.3_

### Phase 7: Property-Based Tests - Correctness Properties

- [ ] 30. Write property test for Attempt Monotonicity
  - **Property 1: Attempt Monotonicity**
  - **Validates: Requirement 4.2, 8.4**
  - For any SolveResult, all attemptNumbers form a contiguous sequence starting at 1
  - Property: If attempts array length = n, then attempts[i].attemptNumber = i+1 for all i
  - Generate: Random number of attempts (1-3), random success/failure patterns
  - Assert: attemptNumbers are exactly [1], [1,2], or [1,2,3]
  - Assert: timestamps are non-decreasing

- [ ] 31. Write property test for Candidate Exclusion Correctness
  - **Property 2: Candidate Exclusion Correctness**
  - **Validates: Requirement 9.2, 9.3, 9.4**
  - Once an anchor fails, it never appears in subsequent attempts
  - Property: For any anchor in failedAnchorIds, no future attempt selects it
  - Generate: Random corridor with 3-5 anchors, random failure patterns
  - Assert: No failed anchor reappears as selectedAnchorId in later attempts
  - Assert: failedAnchorIds accumulates, never decreases

- [ ] 32. Write property test for Best Quote Selection
  - **Property 3: Best Quote Selection**
  - **Validates: Requirement 11.1, 11.2**
  - The selected quote always has the highest totalReceived among valid quotes
  - Property: selectedRate.totalReceived >= all other valid quotes' totalReceived
  - Generate: Random set of 3-5 quotes with different totalReceived values
  - Assert: selectedRate.totalReceived is maximum
  - Assert: No valid quote with higher totalReceived exists

- [ ] 33. Write property test for Serialization Round-Trip
  - **Property 4: Serialization Round-Trip**
  - **Validates: Requirement 12.2, 12.4**
  - SolveResult serializes to JSON and deserializes without data loss
  - Property: deserialize(serialize(result)) == result (deep equality)
  - Generate: Complete SolveResult with 1-3 attempts, various quote values
  - Assert: Deserialized result matches original
  - Assert: quote object remains AnchorRate equivalent after round-trip
  - Assert: No fields become undefined

- [ ] 34. Write property test for Attempt History Completeness
  - **Property 5: Attempt History Completeness**
  - **Validates: Requirement 8.1, 8.2**
  - All attempts in a resolution flow are recorded in the attempts array
  - Property: No attempt is lost or skipped
  - Generate: Solve flows with 1-3 attempts including rejections
  - Assert: attempts.length matches expected count for flow type
  - Assert: For rejection flows, rejection attempt is included
  - Assert: For fallback flows, fallback attempt is included

- [ ] 35. Write property test for Maximum Attempt Enforcement
  - **Property 6: Maximum Attempt Enforcement**
  - **Validates: Requirement 4.1, 4.2**
  - No resolution flow ever exceeds 3 total attempts
  - Property: attempts.length <= 3 for any SolveResult
  - Generate: All possible solve scenarios (success, rejection, exhaustion)
  - Assert: attempts.length is in {1, 2, 3}
  - Assert: Max attemptNumber seen is 3
  - Assert: No SolveResult has more than 3 attempts

- [ ] 36. Write property test for Candidate Count Invariant
  - **Property 7: Candidate Count Invariant**
  - **Validates: Requirement 6.6**
  - Remaining candidates count never exceeds total available anchors
  - Property: candidatesRemaining <= total_anchors_for_corridor
  - Generate: Corridors with 1-10 anchors, various attempt sequences
  - Assert: candidatesRemaining in logged attempts is always <= total anchors
  - Assert: After selecting an anchor, candidatesRemaining decreases by 1

### Phase 8: Edge Case and Error Handling Tests

- [ ] 37. Write unit test: handle SEP-24 transfer server not available
  - Mock anchor without TRANSFER_SERVER_SEP0024
  - Verify quote fetch returns error "No transfer server available"
  - Verify anchor is marked as failed
  - Verify next attempt filters out this anchor
  - _Requirements: 10.2_

- [ ] 38. Write unit test: handle network failure in fee fetch
  - Mock getSep24Fee to throw network error
  - Verify error is caught and logged
  - Verify anchor is marked as failed
  - Verify solve continues to next anchor
  - _Requirements: 10.6_

- [ ] 39. Write unit test: handle malformed quote data
  - Mock getSep24Fee to return invalid AnchorRate structure
  - Verify validation catches the error
  - Verify anchor is marked as failed
  - Verify process continues safely
  - _Requirements: 11.5_

- [ ] 40. Write unit test: handle concurrent solve() calls with same corridor
  - Call solve() twice simultaneously with same corridor
  - Verify each gets independent solveRequestId
  - Verify no cross-contamination between flows
  - Verify both complete successfully
  - _Requirements: 1.6_

- [ ] 41. Write unit test: handle zero amount edge case
  - Call solve() with amount = "0"
  - Verify calculation of totalReceived = (0 - fee) * exchangeRate
  - Verify quote can still be selected
  - _Requirements: 11.4_

- [ ] 42. Write unit test: handle tie in totalReceived values
  - Mock 2 anchors with identical totalReceived
  - Verify one is selected (deterministically)
  - Verify no error occurs
  - _Requirements: 11.3_

### Phase 9: Test File Organization and Setup

- [ ] 43. Create tests/router/solve.spec.ts with unit and integration tests
  - Import and setup mocking utilities (vi.mock, vi.fn)
  - Create reusable mock fixtures for anchors, quotes, params
  - Organize tests into describe blocks: "solve()", "handleQuoteRejection()", "logSolveAttempt()"
  - Each test should be isolated and independent
  - Use beforeEach to reset mocks
  - _Requirements: All unit test requirements_

- [ ] 44. Create tests/router/solve-properties.spec.ts for property-based tests
  - Import fast-check or similar PBT library
  - Create Property 1-7 test cases
  - Use arbitraries for: anchors, quotes, failure patterns
  - Each property test should use 100+ generated examples
  - Document property semantics in comments
  - _Requirements: Property test requirements (30-36)_

- [ ] 45. Create tests/router/solve-edge-cases.spec.ts for edge cases
  - Organize edge case tests from Phase 8
  - Group by category: network errors, data validation, concurrency, edge values
  - Include boundary tests: min/max values, empty/null conditions
  - Document each edge case and why it's important
  - _Requirements: 37-42_

- [ ] 46. Create shared test fixtures and utilities
  - Create helper function: createMockAnchor(id, name) → ResolvedAnchor
  - Create helper function: createMockRate(totalReceived, fee) → AnchorRate
  - Create helper function: createMockSolveParams() → SolveParams
  - Create mock factory for SEP-24 fee responses
  - Export fixtures from tests/fixtures/solve-fixtures.ts
  - _Requirements: Test infrastructure_

### Phase 10: Verification and Integration

- [ ] 47. Run all unit tests and verify coverage
  - Execute: npm test tests/router/solve.spec.ts
  - Verify all tests pass
  - Check code coverage >= 90% for solve.ts
  - Fix any coverage gaps
  - _Requirements: All unit test requirements_

- [ ] 48. Run all property-based tests and verify validity
  - Execute: npm test tests/router/solve-properties.spec.ts
  - Verify all 7 properties pass with 100+ examples each
  - Review any failures and strengthen properties or implementation
  - _Requirements: Property test requirements (30-36)_

- [ ] 49. Run edge case tests and verify robustness
  - Execute: npm test tests/router/solve-edge-cases.spec.ts
  - Verify all edge cases are handled gracefully
  - Verify no crashes or unhandled exceptions
  - _Requirements: 37-42_

- [ ] 50. Checkpoint - Ensure all tests pass
  - Run full test suite: npm test tests/router/
  - Verify 100% of solve.ts tests pass
  - Verify no flaky tests
  - Verify test execution time is acceptable
  - Ask the user if questions arise.

- [ ] 51. Verify implementation matches design specifications
  - Review solve.ts against design Algorithm section
  - Verify all control flow matches pseudocode
  - Check all error messages match specification exactly
  - Verify attempt numbering rules (1, 2, 3 only)
  - Verify logging includes all required fields
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 10.1-10.6, 14.1-14.5_

- [ ] 52. Verify integration with external systems
  - Confirm getAnchorsByCorridorId usage is correct
  - Confirm getSep24Fee is called with correct parameters
  - Confirm logStructured receives all required fields
  - Verify generateRequestId is called and used for correlation
  - _Requirements: 1.3, 6.2, 6.3_

- [ ] 53. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

### Testing Strategy

- **Unit tests** validate individual functions and single-feature scenarios
- **Integration tests** verify interaction between solve() and handleQuoteRejection()
- **Property-based tests** verify universal correctness properties hold across all inputs
- **Edge case tests** cover boundary conditions and error scenarios
- **All tests are isolated** using vi.mock() for external dependencies
- **Mocking strategy** uses predictable fixtures to enable deterministic testing

### Test File Structure

```
tests/router/
├── solve.spec.ts              # Unit + integration tests
├── solve-properties.spec.ts   # Property-based tests (7 properties)
├── solve-edge-cases.spec.ts   # Edge case tests
└── __fixtures__/
    └── solve-fixtures.ts      # Shared mock factories and utilities
```

### Property-Based Testing

The 7 correctness properties ensure universal guarantees:
1. **Attempt Monotonicity**: Attempt numbers are 1, 2, 3 in order
2. **Candidate Exclusion**: Failed anchors never reappear
3. **Best Quote Selection**: Selected quote has highest totalReceived
4. **Serialization Round-Trip**: JSON serialization is lossless
5. **Attempt History Completeness**: All attempts are recorded
6. **Maximum Attempt Enforcement**: Never more than 3 attempts
7. **Candidate Count Invariant**: Remaining candidates ≤ total anchors

### Implementation Notes

- The solve() function uses a for-loop (attemptNumber 1 to 3) with early exit on success
- The handleQuoteRejection() function is a specialized re-solve with rejection tracking
- The failedAnchorIds set prevents retry of failed anchors
- All quote fetching is parallel via Promise.all() for performance
- Attempt timestamps and durations are critical for reputation scoring
- The solveRequestId correlates all attempts in a single resolution flow

### Assumption: TypeScript and Vitest

- Tests use Vitest (vi.mock, vi.fn, describe, it)
- PBT uses fast-check library (fc.property, fc.assert)
- TypeScript types are strictly enforced
- All code follows existing project conventions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "3", "4", "5"] },
    { "id": 1, "tasks": ["6", "7", "8", "9", "10", "11", "12"] },
    { "id": 2, "tasks": ["13", "14", "15", "16", "17", "18", "19", "20", "21", "22"] },
    { "id": 3, "tasks": ["23", "24", "25", "26"] },
    { "id": 4, "tasks": ["27", "28", "29"] },
    { "id": 5, "tasks": ["30", "31", "32", "33", "34", "35", "36"] },
    { "id": 6, "tasks": ["37", "38", "39", "40", "41", "42"] },
    { "id": 7, "tasks": ["43", "44", "45", "46"] },
    { "id": 8, "tasks": ["47", "48", "49"] },
    { "id": 9, "tasks": ["50", "51", "52", "53"] }
  ]
}
```
