# Requirements Document: Fallback Anchor Resolution

## Introduction

When a user's selected anchor rejects a firm quote or the quote expires before confirmation, the system must automatically attempt resolution with other available anchors. This feature implements intelligent fallback resolution with a maximum of 2 fallback attempts (3 total attempts: 1 initial + 2 fallbacks), while maintaining a unified user experience and tracking all attempts for reputation scoring and monitoring.

The feature is part of the Intent Router + Seeds v1.2 feature set and primarily affects the quote resolution flow in `lib/router/solve.ts`.

## Glossary

- **Anchor**: A Stellar-compliant financial service that supports SEP-24 (or SEP-38) transactions
- **Corridor**: A payment route from one asset to a fiat currency in a specific country (e.g., USDC → NGN)
- **Quote**: A price quote from an anchor for a specific amount and corridor, including fees and exchange rates
- **Firm Quote**: A time-bound quote that commits pricing for a transaction (typically expires within minutes)
- **Solve**: The process of fetching quotes from all available anchors for a corridor and selecting the best rate
- **Quote Rejection**: An anchor's refusal to honor a firm quote, either due to expiration or explicit rejection
- **Fallback Attempt**: A re-solve operation using remaining candidates after the initially selected anchor rejects the quote
- **Attempt**: A single iteration of the solve process, tracked with metadata for reputation scoring
- **Solve Request**: A collection of attempts for a single user-initiated resolution flow, tracked via unique requestId
- **Selected Anchor**: The anchor chosen from the solve attempt as offering the best rate (highest total received)
- **Remaining Candidates**: Anchors not yet attempted or failed in the current resolution flow
- **Total Received**: The net amount the user receives after fees and exchange rate conversion: (amount - fee) × exchangeRate
- **Reputation Score**: An anchor's cumulative rating based on historical quote rejection patterns and transaction outcomes

## Requirements

### Requirement 1: Initial Quote Resolution

**User Story:** As a user, I want to get the best available quote across all anchors, so that I receive optimal rates for my transaction.

#### Acceptance Criteria

1. WHEN a solve request is initiated, THE Solver SHALL fetch quotes from all anchors available for the specified corridor in parallel
2. WHEN all quote fetches complete, THE Solver SHALL rank anchors by total received (highest first) to identify the best rate
3. WHEN the best quote is selected, THE Solver SHALL return the selected anchor and its quote as the result
4. THE Solver SHALL record the attempt with attemptNumber=1, the selected anchor details, the quote, and no error message
5. WHEN an attempt completes successfully, THE Solver SHALL measure and log the duration in milliseconds
6. THE Solver SHALL assign a unique solveRequestId to correlate all attempts in the resolution flow

### Requirement 2: Quote Rejection Detection and Fallback Trigger

**User Story:** As the system, I want to detect when an anchor rejects a quote, so that I can automatically attempt resolution with alternative anchors.

#### Acceptance Criteria

1. WHEN an anchor rejects a firm quote (either explicit rejection or expiration before confirmation), THE System SHALL trigger the fallback resolution flow
2. THE System SHALL invoke handleQuoteRejection with the rejected anchor's ID, previous attempts, and corridor parameters
3. WHEN handleQuoteRejection is invoked, THE System SHALL log a rejection attempt with error message "Quote rejected by anchor"
4. THE Rejection Attempt SHALL have attemptNumber = (previous attempts count + 1) and selectedAnchorId = rejectedAnchorId
5. THE System SHALL preserve the complete history of all previous attempts when creating the rejection attempt record

### Requirement 3: Fallback Resolution with Remaining Candidates

**User Story:** As a user, I want alternative quotes to be automatically fetched when my initially selected anchor becomes unavailable, so that my transaction can proceed smoothly.

#### Acceptance Criteria

1. WHEN a rejection is processed, THE Resolver SHALL identify remaining candidate anchors (all anchors except those that have failed)
2. THE Resolver SHALL exclude anchors that explicitly rejected quotes or failed in previous attempts
3. WHEN remaining candidates exist, THE Resolver SHALL fetch quotes from all remaining candidates in parallel
4. THE Resolver SHALL rank the remaining quotes by total received and select the best rate
5. WHEN a fallback attempt succeeds, THE Resolver SHALL return the new selected anchor and quote as the result
6. THE Fallback Attempt SHALL have attemptNumber = (previous attempts count + 2) and SHALL be marked as error=null on success
7. WHEN no remaining candidates have valid quotes, THE Resolver SHALL return failure with error "No valid quotes from remaining anchors"

### Requirement 4: Maximum Attempt Limit

**User Story:** As an operator, I want to limit retry attempts to prevent excessive API calls and timeouts, so that the system remains performant and responsive.

#### Acceptance Criteria

1. THE System SHALL enforce a maximum of 3 total attempts (1 initial + 2 fallbacks)
2. WHEN the solve process begins, THE System SHALL iterate with attemptNumber values 1, 2, and 3
3. WHEN a rejection is triggered after 2 successful attempts have been made, THE System SHALL return error "Max fallback attempts exhausted (2 fallbacks allowed)"
4. WHEN all candidates are exhausted before reaching the maximum attempts, THE System SHALL exit early with error "All anchors have been exhausted after rejection attempts"
5. THE Resolver SHALL track the count of successful attempts (error=null) separately from total attempts attempted

### Requirement 5: Exhaustion Detection

**User Story:** As the system, I want to detect when all available anchors have been tried, so that I can inform the user that no further attempts are possible.

#### Acceptance Criteria

1. WHEN the last remaining candidate anchor fails or is exhausted, THE System SHALL return failure
2. WHEN all anchors for a corridor have been tried (either rejected or failed), THE System SHALL return error "All anchors have been exhausted after rejection attempts" or "No remaining anchors after rejection"
3. THE System SHALL continue fallback attempts only if candidateAnchors.length > 0 after filtering failed anchors
4. WHEN a rejection is triggered but no candidates remain, THE System SHALL immediately return failure without attempting further resolution

### Requirement 6: Comprehensive Attempt Logging

**User Story:** As a reputation monitor, I want complete audit logs of all resolution attempts, so that I can track anchor reliability and identify patterns.

#### Acceptance Criteria

1. EACH Attempt SHALL record: attemptNumber, selectedAnchorId, selectedAnchorName, quote, error, timestamp, and durationMs
2. THE logSolveAttempt function SHALL log structured data including: solveRequestId, corridorId, amount, attemptNumber, success status, error message, and candidatesRemaining
3. WHEN an attempt completes, THE System SHALL log within the same attempt (no separate log calls for success/failure)
4. THE Timestamp SHALL be recorded in ISO 8601 format at the moment the attempt is created
5. THE durationMs field SHALL capture elapsed time in milliseconds from attempt start to completion (measurement timing)
6. THE candidatesRemaining field SHALL reflect the count of candidates not yet tried in the current attempt (excluding the selected anchor)

### Requirement 7: Unified User Experience

**User Story:** As a user, I want the fallback mechanism to work transparently, so that I experience a single coherent flow regardless of how many fallbacks were needed.

#### Acceptance Criteria

1. THE System SHALL return a single SolveResult object to the caller, regardless of whether fallbacks were triggered
2. WHEN the final result is returned, THE SolveResult.success field SHALL indicate true only if a quote was successfully obtained
3. THE SolveResult.selectedAnchor and selectedRate SHALL contain the final selected values (from the successful attempt, which may be a fallback)
4. WHEN fallbacks occurred, THE User Experience SHALL present the final result without exposing intermediate rejection attempts
5. INTERNAL System Logging SHALL capture all attempts (rejection and fallback) but external API responses SHALL present only the final outcome

### Requirement 8: Attempt History Preservation

**User Story:** As a monitoring system, I want to retain the complete resolution history, so that I can audit the flow and perform post-analysis.

#### Acceptance Criteria

1. THE SolveResult.attempts array SHALL contain all attempts in sequential order: [attempt1, rejection_attempt, fallback_attempt, ...]
2. WHEN a rejection triggers a fallback, THE Previous Attempts SHALL be prepended to the new attempt history
3. WHEN the final result is returned, THE attempts array SHALL be complete and immutable for that result
4. THE System SHALL preserve the original attemptNumber values (1, 2, 3) which reflect the actual attempt sequence
5. EACH Attempt in the history SHALL be retrievable by attemptNumber for correlation and analysis

### Requirement 9: Exclusion of Failed Candidates

**User Story:** As the resolver, I want to track which anchors have failed, so that I don't retry the same failing anchors.

#### Acceptance Criteria

1. WHEN an anchor fails with an error (either rejection or network error), THE System SHALL add its ID to failedAnchorIds set
2. WHEN filtering candidates for a fallback attempt, THE System SHALL exclude all anchors in failedAnchorIds
3. WHEN an anchor is rejected, THE System SHALL add the rejectedAnchorId to the failed set before filtering remaining candidates
4. THE System SHALL also mark anchors as failed if they appear in previousAttempts with error !== null
5. THE Candidate Filtering Logic SHALL be: availableAnchors = allAnchors.filter(a => !failedAnchorIds.has(a.id))

### Requirement 10: Error Classification and Reporting

**User Story:** As a developer, I want clear error messages for different failure modes, so that I can debug and fix issues efficiently.

#### Acceptance Criteria

1. WHEN no anchors are available for a corridor, THE System SHALL return finalError = "No anchors available for corridor {corridorId}"
2. WHEN no valid quotes are received from any attempt, THE System SHALL return finalError = "No valid quotes received from any anchor" or "No valid quotes from remaining anchors"
3. WHEN all anchors are exhausted, THE System SHALL return finalError = "All anchors have been exhausted after rejection attempts"
4. WHEN max fallback attempts are exceeded, THE System SHALL return finalError = "Max fallback attempts exhausted (2 fallbacks allowed)"
5. WHEN a rejection occurs but no candidates remain, THE System SHALL return finalError = "No remaining anchors after rejection"
6. WHEN a network or processing error occurs, THE System SHALL include the specific error message in the attempt's error field

### Requirement 11: Quote Selection Strategy

**User Story:** As a user, I want the system to consistently select the best quote, so that my rate is optimized across all resolution attempts.

#### Acceptance Criteria

1. THE Selector SHALL rank all valid quotes by totalReceived value in descending order (highest first)
2. THE Selector SHALL select the quote at index [0] of the sorted array as the best quote
3. WHEN multiple anchors have identical totalReceived values, THE Selector's behavior is deterministic (undefined tie-breaking is acceptable per implementation)
4. THE Selector SHALL only consider quotes where error === null (i.e., quote !== null and fetched successfully)
5. THE Selector SHALL skip quotes with missing exchangeRate or invalid totalReceived calculations

### Requirement 12: Parser and Serializer Requirements

**User Story:** As a system integrator, I want reliable serialization of SolveResult and SolveAttempt data, so that logs and APIs work correctly.

#### Acceptance Criteria

1. THE SolveResult Type SHALL be serializable to JSON without circular references or undefined values
2. WHEN SolveResult is serialized, THE attempts array SHALL be fully serializable with all SolveAttempt fields included
3. THE SolveAttempt Type SHALL serialize successfully with all required fields: attemptNumber, selectedAnchorId, selectedAnchorName, quote, error, timestamp, durationMs
4. WHEN SolveResult is serialized and then deserialized, THE quote object SHALL round-trip correctly (deserialize to AnchorRate equivalent)
5. WHEN SolveResult is logged via logSolveAttempt, ALL relevant fields SHALL be included in the structured log output

### Requirement 13: Concurrency and Parallel Fetching

**User Story:** As a performance optimizer, I want quotes fetched in parallel, so that resolution is fast and not serialized.

#### Acceptance Criteria

1. WHEN multiple anchors are available, THE Solver SHALL fetch quotes using Promise.all() or Promise.allSettled()
2. THE Quote Fetches SHALL run concurrently (not sequentially) for all candidate anchors
3. WHEN any individual quote fetch fails, THE System SHALL not block other ongoing fetches
4. WHEN all quote fetches complete, THE System SHALL proceed to selection regardless of individual failures
5. WHEN a fallback is triggered, THE Resolver SHALL again fetch quotes in parallel from remaining candidates

### Requirement 14: Reputation Impact and Tracking

**User Story:** As a reputation system, I want to record all rejection events, so that anchor scores reflect reliability patterns.

#### Acceptance Criteria

1. WHEN a quote rejection occurs, THE System SHALL create a rejection attempt record with explicit error message "Quote rejected by anchor"
2. WHEN a rejection attempt is logged, THE Reputation System SHALL later be able to query this event via the solveRequestId correlation ID
3. THE logSolveAttempt call for rejection events SHALL include solveRequestId, anchorId, and failure indicator
4. THE rejection_attempt (attemptNumber=2) and fallback_attempt (attemptNumber=3) SHALL both be logged to enable reputation tracking
5. THE Reputation System SHALL be able to distinguish between: initial attempts (attempt=1), rejections (error="Quote rejected by anchor"), and fallbacks (error=null, attemptNumber>1)

## Design Notes

- The solve process uses a for-loop (attemptNumber 1 to 3) with early exit on success
- The handleQuoteRejection function augments previous attempts and performs a limited re-solve
- The failedAnchorIds set tracks anchors to exclude from fallback candidates
- All attempt timing includes network latency for SEP-24/SEP-38 calls
- Parallel quote fetching is critical for performance; sequential would cause 3x latency
- The unified UX means external APIs see only success/failure, not intermediate attempts (the attempts array is internal audit data)
- Reputation scoring will consume the logged attempt data post-resolution

## Test Coverage Expectations

These requirements are designed to enable comprehensive property-based testing for:

1. **Round-trip properties**: Attempt data serializes and deserializes without loss
2. **Invariants**: solveRequestId is unique per solve flow; attemptNumber increases monotonically
3. **Metamorphic properties**: candidatesRemaining always ≤ total anchors for corridor
4. **Error conditions**: Invalid inputs return appropriate error messages; edge cases handled gracefully
5. **Max attempt enforcement**: No resolution flow ever exceeds 3 attempts
6. **Candidate exclusion**: Failed anchors never reappear in subsequent attempts
7. **History preservation**: All attempts are chronologically ordered and complete
