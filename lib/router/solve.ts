import type { ResolvedAnchor, AnchorRate } from '@/types';
import { getAnchorsByCorridorId, getResolvedAnchorById } from '@/lib/stellar/anchors';
import { getSep24Fee } from '@/lib/stellar/sep24';
import { generateRequestId, logStructured } from '@/lib/api/logging';

/**
 * Represents a single solve attempt with its result.
 * Used for tracking all resolution attempts for reputation and debugging.
 */
export interface SolveAttempt {
  attemptNumber: 1 | 2 | 3;
  selectedAnchorId: string;
  selectedAnchorName: string;
  quote: AnchorRate | null;
  error: string | null;
  timestamp: string;
  durationMs?: number;
}

/**
 * Result of the solve operation with fallback tracking.
 */
export interface SolveResult {
  success: boolean;
  selectedAnchor: ResolvedAnchor | null;
  selectedRate: AnchorRate | null;
  attempts: SolveAttempt[];
  finalError: string | null;
  solveRequestId?: string;
}

/**
 * Logs a solve attempt for reputation tracking and monitoring.
 * This is designed for ingestion into log aggregation systems.
 */
function logSolveAttempt(
  solveRequestId: string,
  params: { corridorId: string; amount: string },
  attempt: SolveAttempt,
  candidatesRemaining: number
): void {
  const log: Record<string, unknown> = {
    timestamp: attempt.timestamp,
    solveRequestId,
    corridorId: params.corridorId,
    amount: params.amount,
    attemptNumber: attempt.attemptNumber,
    selectedAnchorId: attempt.selectedAnchorId,
    selectedAnchorName: attempt.selectedAnchorName,
    success: attempt.error === null,
    durationMs: attempt.durationMs ?? 0,
    totalAttempts: 3, // Max attempts hardcoded
    remainingCandidates: candidatesRemaining,
  };

  if (attempt.error) {
    log.error = attempt.error;
  }

  logStructured(log);
}

/**
 * Solves for the best anchor quote with fallback re-solve on rejection.
 *
 * Algorithm:
 * 1. Get all anchors for the corridor
 * 2. Fetch quotes from all anchors in parallel
 * 3. Select the best quote (highest totalReceived)
 * 4. If the selected anchor rejects the quote, mark it as failed
 * 5. Re-solve with remaining candidates (max 2 fallback attempts)
 * 6. Log all attempts for reputation tracking
 *
 * Attempt tracking:
 * - Attempt 1: Initial solve (all candidates)
 * - Attempt 2: First fallback (after rejection)
 * - Attempt 3: Second fallback (after second rejection)
 *
 * @param params - The solve parameters
 * @returns SolveResult with selected anchor, rate, and attempt history
 */
export async function solve(params: {
  corridorId: string;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  feeType: string;
}): Promise<SolveResult> {
  const solveRequestId = generateRequestId();
  const attempts: SolveAttempt[] = [];
  const failedAnchorIds = new Set<string>();
  let selectedAnchor: ResolvedAnchor | null = null;
  let selectedRate: AnchorRate | null = null;
  let finalError: string | null = null;

  // Max 2 fallback attempts = 3 total attempts (initial + 2 fallbacks)
  const maxAttempts = 3;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const attemptStartTime = Date.now();

    try {
      // Get all anchors for this corridor
      const allAnchors = getAnchorsByCorridorId(params.corridorId);

      if (allAnchors.length === 0) {
        finalError = `No anchors available for corridor ${params.corridorId}`;
        break;
      }

      // Filter out failed anchors from previous attempts
      const candidateAnchors = allAnchors.filter((a) => !failedAnchorIds.has(a.id));

      if (candidateAnchors.length === 0) {
        finalError = 'All anchors have been exhausted after rejection attempts';
        break;
      }

      // Fetch quotes from all candidate anchors in parallel
      const quotePromises = candidateAnchors.map(async (anchor) => {
        try {
          const resolved = await getResolvedAnchorById(anchor.id);
          const transferServer = resolved.TRANSFER_SERVER_SEP0024;

          if (!transferServer) {
            return {
              anchorId: anchor.id,
              anchorName: anchor.name,
              quote: null,
              error: 'No transfer server available',
            };
          }

          const feeResult = await getSep24Fee({
            transferServer,
            assetCode: params.assetCode,
            assetIssuer: params.assetIssuer,
            amount: params.amount,
            type: params.feeType,
          });

          if (!feeResult.ok) {
            return {
              anchorId: anchor.id,
              anchorName: anchor.name,
              quote: null,
              error: `Fee fetch failed: ${feeResult.reason}`,
            };
          }

          // Construct the AnchorRate
          const fee = typeof feeResult.fee === 'string' ? parseFloat(feeResult.fee) : feeResult.fee;
          const exchangeRate = 1; // Placeholder; in real implementation, fetch from market data
          const totalReceived = (parseFloat(params.amount) - fee) * exchangeRate;

          const rate: AnchorRate = {
            anchorId: anchor.id,
            anchorName: anchor.name,
            corridorId: params.corridorId,
            fee: fee.toString(),
            feeType: 'flat', // Placeholder; real implementation derives from anchor
            exchangeRate,
            totalReceived,
            source: 'sep24-fee',
            updatedAt: new Date(),
          };

          return {
            anchorId: anchor.id,
            anchorName: anchor.name,
            quote: rate,
            error: null,
          };
        } catch (err) {
          return {
            anchorId: anchor.id,
            anchorName: anchor.name,
            quote: null,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }
      });

      const quoteResults = await Promise.all(quotePromises);

      // Find the best quote
      const validQuotes = quoteResults.filter((r) => r.quote !== null);

      if (validQuotes.length === 0) {
        finalError = 'No valid quotes received from any anchor';
        break;
      }

      // Sort by totalReceived (descending) to get the best rate
      validQuotes.sort((a, b) => {
        const aTotal = a.quote?.totalReceived ?? 0;
        const bTotal = b.quote?.totalReceived ?? 0;
        return bTotal - aTotal;
      });

      const bestQuote = validQuotes[0];
      selectedRate = bestQuote.quote!;
      selectedAnchor = await getResolvedAnchorById(bestQuote.anchorId);

      const durationMs = Date.now() - attemptStartTime;
      const candidatesRemaining = candidateAnchors.length - 1; // Subtract the selected one

      // Log this successful attempt
      const attempt: SolveAttempt = {
        attemptNumber,
        selectedAnchorId: bestQuote.anchorId,
        selectedAnchorName: bestQuote.anchorName,
        quote: selectedRate,
        error: null,
        timestamp: new Date().toISOString(),
        durationMs,
      };

      attempts.push(attempt);
      logSolveAttempt(solveRequestId, params, attempt, candidatesRemaining);

      // Success! Return the result
      return {
        success: true,
        selectedAnchor,
        selectedRate,
        attempts,
        finalError: null,
        solveRequestId,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const durationMs = Date.now() - attemptStartTime;

      // Log the failed attempt
      const attempt: SolveAttempt = {
        attemptNumber,
        selectedAnchorId: selectedAnchor?.id ?? 'unknown',
        selectedAnchorName: selectedAnchor?.name ?? 'unknown',
        quote: null,
        error: errorMsg,
        timestamp: new Date().toISOString(),
        durationMs,
      };

      attempts.push(attempt);

      const candidatesRemaining = Math.max(
        0,
        getAnchorsByCorridorId(params.corridorId).length - failedAnchorIds.size - 1
      );
      logSolveAttempt(solveRequestId, params, attempt, candidatesRemaining);

      // Mark the selected anchor as failed for next attempt
      if (selectedAnchor) {
        failedAnchorIds.add(selectedAnchor.id);
      }

      finalError = errorMsg;

      // Continue to next attempt if we haven't exhausted attempts
      if (attemptNumber < maxAttempts) {
        continue;
      }
    }
  }

  return {
    success: false,
    selectedAnchor: null,
    selectedRate: null,
    attempts,
    finalError,
    solveRequestId,
  };
}

/**
 * Handles anchor quote rejection and triggers re-solve with remaining candidates.
 *
 * This function is called when:
 * - An anchor rejects a firm quote (expired or invalid)
 * - A quote expires before confirmation
 * - Network timeout on quote confirmation
 *
 * Behavior:
 * - Marks the anchor as failed
 * - Attempts to solve again with remaining candidates
 * - Respects the max 3 total attempts limit (1 initial + 2 fallbacks)
 * - Logs all rejection events for reputation tracking
 * - Returns unified result to caller (UX sees single flow)
 *
 * @param rejectedAnchorId - The ID of the anchor that rejected the quote
 * @param previousAttempts - The attempts from the previous solve call
 * @param params - The solve parameters (corridor, amount, etc.)
 * @returns SolveResult with fallback attempts and complete history
 */
export async function handleQuoteRejection(
  rejectedAnchorId: string,
  previousAttempts: SolveAttempt[],
  params: {
    corridorId: string;
    amount: string;
    assetCode: string;
    assetIssuer: string;
    feeType: string;
  }
): Promise<SolveResult> {
  // Determine the solve request ID from previous attempts or generate new one
  const solveRequestId = generateRequestId();

  // Log the rejection event (instant operation, but track timing)
  const rejectionAttemptStart = Date.now();
  const rejectionAttempt: SolveAttempt = {
    attemptNumber: previousAttempts.length + 1,
    selectedAnchorId: rejectedAnchorId,
    selectedAnchorName: 'unknown',
    quote: null,
    error: 'Quote rejected by anchor',
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - rejectionAttemptStart,
  };

  // Get all anchors and filter out the rejected one and any previously failed ones
  const allAnchors = getAnchorsByCorridorId(params.corridorId);
  const failedAnchorIds = new Set<string>([rejectedAnchorId]);

  // Also add any anchors that failed in previous attempts
  for (const attempt of previousAttempts) {
    if (attempt.error !== null) {
      failedAnchorIds.add(attempt.selectedAnchorId);
    }
  }

  const candidateAnchors = allAnchors.filter((a) => !failedAnchorIds.has(a.id));

  // If no candidates remain, return failure
  if (candidateAnchors.length === 0) {
    return {
      success: false,
      selectedAnchor: null,
      selectedRate: null,
      attempts: [...previousAttempts, rejectionAttempt],
      finalError: 'No remaining anchors after rejection',
      solveRequestId,
    };
  }

  // Enforce max 3 total attempts: rejection would be attempt N+1, fallback would be N+2
  // If N+2 > 3, reject. This means if previousAttempts.length > 1, we can't proceed
  if (previousAttempts.length + 2 > 3) {
    return {
      success: false,
      selectedAnchor: null,
      selectedRate: null,
      attempts: [...previousAttempts, rejectionAttempt],
      finalError: 'Max fallback attempts exhausted (2 fallbacks allowed)',
      solveRequestId,
    };
  }

  // Fetch quotes from remaining candidates
  const quotePromises = candidateAnchors.map(async (anchor) => {
    try {
      const resolved = await getResolvedAnchorById(anchor.id);
      const transferServer = resolved.TRANSFER_SERVER_SEP0024;

      if (!transferServer) {
        return {
          anchorId: anchor.id,
          anchorName: anchor.name,
          quote: null,
          error: 'No transfer server available',
        };
      }

      const feeResult = await getSep24Fee({
        transferServer,
        assetCode: params.assetCode,
        assetIssuer: params.assetIssuer,
        amount: params.amount,
        type: params.feeType,
      });

      if (!feeResult.ok) {
        return {
          anchorId: anchor.id,
          anchorName: anchor.name,
          quote: null,
          error: `Fee fetch failed: ${feeResult.reason}`,
        };
      }

      const fee = typeof feeResult.fee === 'string' ? parseFloat(feeResult.fee) : feeResult.fee;
      const exchangeRate = 1;
      const totalReceived = (parseFloat(params.amount) - fee) * exchangeRate;

      const rate: AnchorRate = {
        anchorId: anchor.id,
        anchorName: anchor.name,
        corridorId: params.corridorId,
        fee: fee.toString(),
        feeType: 'flat',
        exchangeRate,
        totalReceived,
        source: 'sep24-fee',
        updatedAt: new Date(),
      };

      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        quote: rate,
        error: null,
      };
    } catch (err) {
      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        quote: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  });

  const quoteResults = await Promise.all(quotePromises);
  const validQuotes = quoteResults.filter((r) => r.quote !== null);

  // If no valid quotes from remaining candidates, return failure
  if (validQuotes.length === 0) {
    return {
      success: false,
      selectedAnchor: null,
      selectedRate: null,
      attempts: [...previousAttempts, rejectionAttempt],
      finalError: 'No valid quotes from remaining anchors',
      solveRequestId,
    };
  }

  // Sort by totalReceived (descending) to get the best rate from remaining
  validQuotes.sort((a, b) => {
    const aTotal = a.quote?.totalReceived ?? 0;
    const bTotal = b.quote?.totalReceived ?? 0;
    return bTotal - aTotal;
  });

  const bestQuote = validQuotes[0];
  const selectedAnchor = await getResolvedAnchorById(bestQuote.anchorId);

  const fallbackAttempt: SolveAttempt = {
    attemptNumber: previousAttempts.length + 2,
    selectedAnchorId: bestQuote.anchorId,
    selectedAnchorName: bestQuote.anchorName,
    quote: bestQuote.quote,
    error: null,
    timestamp: new Date().toISOString(),
  };

  // Log the successful fallback attempt
  logSolveAttempt(solveRequestId, params, fallbackAttempt, candidateAnchors.length - 1);

  return {
    success: true,
    selectedAnchor,
    selectedRate: bestQuote.quote,
    attempts: [...previousAttempts, rejectionAttempt, fallbackAttempt],
    finalError: null,
    solveRequestId,
  };
}
