import type { ResolvedAnchor, AnchorRate } from '@/types'
import { getAnchorsByCorridorId, getResolvedAnchorById } from '@/lib/stellar/anchors'
import { getSep24Fee } from '@/lib/stellar/sep24'
import type { Sep24FeeParams } from '@/types'

/**
 * Represents a single solve attempt with its result.
 */
export interface SolveAttempt {
  attemptNumber: number
  selectedAnchorId: string
  selectedAnchorName: string
  quote: AnchorRate | null
  error: string | null
  timestamp: string
}

/**
 * Result of the solve operation with fallback tracking.
 */
export interface SolveResult {
  success: boolean
  selectedAnchor: ResolvedAnchor | null
  selectedRate: AnchorRate | null
  attempts: SolveAttempt[]
  finalError: string | null
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
 * @param corridorId - The corridor ID (e.g., 'usdc-ngn')
 * @param amount - The amount to withdraw
 * @param assetCode - The asset code (e.g., 'USDC')
 * @param assetIssuer - The asset issuer
 * @param feeType - The fee type for SEP-24 (e.g., 'external')
 * @returns SolveResult with selected anchor, rate, and attempt history
 */
export async function solve(params: {
  corridorId: string
  amount: string
  assetCode: string
  assetIssuer: string
  feeType: string
}): Promise<SolveResult> {
  const attempts: SolveAttempt[] = []
  const failedAnchorIds = new Set<string>()
  let selectedAnchor: ResolvedAnchor | null = null
  let selectedRate: AnchorRate | null = null
  let finalError: string | null = null

  // Max 2 fallback attempts = 3 total attempts (initial + 2 fallbacks)
  const maxAttempts = 3

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      // Get all anchors for this corridor
      const allAnchors = getAnchorsByCorridorId(params.corridorId)

      if (allAnchors.length === 0) {
        finalError = `No anchors available for corridor ${params.corridorId}`
        break
      }

      // Filter out failed anchors from previous attempts
      const candidateAnchors = allAnchors.filter((a) => !failedAnchorIds.has(a.id))

      if (candidateAnchors.length === 0) {
        finalError = 'All anchors have been exhausted after rejection attempts'
        break
      }

      // Fetch quotes from all candidate anchors in parallel
      const quotePromises = candidateAnchors.map(async (anchor) => {
        try {
          const resolved = await getResolvedAnchorById(anchor.id)
          const transferServer = resolved.TRANSFER_SERVER_SEP0024

          if (!transferServer) {
            return {
              anchorId: anchor.id,
              anchorName: anchor.name,
              quote: null,
              error: 'No transfer server available',
            }
          }

          const feeResult = await getSep24Fee({
            transferServer,
            assetCode: params.assetCode,
            assetIssuer: params.assetIssuer,
            amount: params.amount,
            type: params.feeType,
          })

          if (!feeResult.ok) {
            return {
              anchorId: anchor.id,
              anchorName: anchor.name,
              quote: null,
              error: `Fee fetch failed: ${feeResult.reason}`,
            }
          }

          // Construct the AnchorRate
          const fee = typeof feeResult.fee === 'string' ? parseFloat(feeResult.fee) : feeResult.fee
          const exchangeRate = 1 // Placeholder; in real implementation, fetch from market data
          const totalReceived = (parseFloat(params.amount) - fee) * exchangeRate

          const rate: AnchorRate = {
            anchorId: anchor.id,
            anchorName: anchor.name,
            corridorId: params.corridorId,
            fee: fee.toString(),
            exchangeRate,
            totalReceived,
            source: 'sep24-fee',
            updatedAt: new Date(),
          }

          return {
            anchorId: anchor.id,
            anchorName: anchor.name,
            quote: rate,
            error: null,
          }
        } catch (err) {
          return {
            anchorId: anchor.id,
            anchorName: anchor.name,
            quote: null,
            error: err instanceof Error ? err.message : 'Unknown error',
          }
        }
      })

      const quoteResults = await Promise.all(quotePromises)

      // Find the best quote
      const validQuotes = quoteResults.filter((r) => r.quote !== null)

      if (validQuotes.length === 0) {
        finalError = 'No valid quotes received from any anchor'
        break
      }

      // Sort by totalReceived (descending) to get the best rate
      validQuotes.sort((a, b) => {
        const aTotal = a.quote?.totalReceived ?? 0
        const bTotal = b.quote?.totalReceived ?? 0
        return bTotal - aTotal
      })

      const bestQuote = validQuotes[0]
      selectedRate = bestQuote.quote!
      selectedAnchor = await getResolvedAnchorById(bestQuote.anchorId)

      // Log this attempt
      attempts.push({
        attemptNumber,
        selectedAnchorId: bestQuote.anchorId,
        selectedAnchorName: bestQuote.anchorName,
        quote: selectedRate,
        error: null,
        timestamp: new Date().toISOString(),
      })

      // Success! Return the result
      return {
        success: true,
        selectedAnchor,
        selectedRate,
        attempts,
        finalError: null,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'

      // Log the failed attempt
      attempts.push({
        attemptNumber,
        selectedAnchorId: selectedAnchor?.id ?? 'unknown',
        selectedAnchorName: selectedAnchor?.name ?? 'unknown',
        quote: null,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      })

      // Mark the selected anchor as failed for next attempt
      if (selectedAnchor) {
        failedAnchorIds.add(selectedAnchor.id)
      }

      finalError = errorMsg

      // Continue to next attempt if we haven't exhausted attempts
      if (attemptNumber < maxAttempts) {
        continue
      }
    }
  }

  return {
    success: false,
    selectedAnchor: null,
    selectedRate: null,
    attempts,
    finalError,
  }
}

/**
 * Handles anchor quote rejection and triggers re-solve with remaining candidates.
 *
 * This function is called when an anchor rejects a firm quote or the quote expires.
 * It marks the anchor as failed and attempts to solve again with remaining candidates.
 *
 * @param rejectedAnchorId - The ID of the anchor that rejected the quote
 * @param previousAttempts - The attempts from the previous solve call
 * @param params - The solve parameters (corridor, amount, etc.)
 * @returns SolveResult with fallback attempts
 */
export async function handleQuoteRejection(
  rejectedAnchorId: string,
  previousAttempts: SolveAttempt[],
  params: {
    corridorId: string
    amount: string
    assetCode: string
    assetIssuer: string
    feeType: string
  }
): Promise<SolveResult> {
  // Log the rejection
  const rejectionAttempt: SolveAttempt = {
    attemptNumber: previousAttempts.length + 1,
    selectedAnchorId: rejectedAnchorId,
    selectedAnchorName: 'unknown',
    quote: null,
    error: 'Quote rejected by anchor',
    timestamp: new Date().toISOString(),
  }

  // Get all anchors and filter out the rejected one
  const allAnchors = getAnchorsByCorridorId(params.corridorId)
  const failedAnchorIds = new Set<string>([rejectedAnchorId])

  // Also add any anchors that failed in previous attempts
  for (const attempt of previousAttempts) {
    if (attempt.error !== null) {
      failedAnchorIds.add(attempt.selectedAnchorId)
    }
  }

  const candidateAnchors = allAnchors.filter((a) => !failedAnchorIds.has(a.id))

  if (candidateAnchors.length === 0) {
    return {
      success: false,
      selectedAnchor: null,
      selectedRate: null,
      attempts: [...previousAttempts, rejectionAttempt],
      finalError: 'No remaining anchors after rejection',
    }
  }

  // Fetch quotes from remaining candidates
  const quotePromises = candidateAnchors.map(async (anchor) => {
    try {
      const resolved = await getResolvedAnchorById(anchor.id)
      const transferServer = resolved.TRANSFER_SERVER_SEP0024

      if (!transferServer) {
        return {
          anchorId: anchor.id,
          anchorName: anchor.name,
          quote: null,
          error: 'No transfer server available',
        }
      }

      const feeResult = await getSep24Fee({
        transferServer,
        assetCode: params.assetCode,
        assetIssuer: params.assetIssuer,
        amount: params.amount,
        type: params.feeType,
      })

      if (!feeResult.ok) {
        return {
          anchorId: anchor.id,
          anchorName: anchor.name,
          quote: null,
          error: `Fee fetch failed: ${feeResult.reason}`,
        }
      }

      const fee = typeof feeResult.fee === 'string' ? parseFloat(feeResult.fee) : feeResult.fee
      const exchangeRate = 1
      const totalReceived = (parseFloat(params.amount) - fee) * exchangeRate

      const rate: AnchorRate = {
        anchorId: anchor.id,
        anchorName: anchor.name,
        corridorId: params.corridorId,
        fee: fee.toString(),
        exchangeRate,
        totalReceived,
        source: 'sep24-fee',
        updatedAt: new Date(),
      }

      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        quote: rate,
        error: null,
      }
    } catch (err) {
      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        quote: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  })

  const quoteResults = await Promise.all(quotePromises)
  const validQuotes = quoteResults.filter((r) => r.quote !== null)

  if (validQuotes.length === 0) {
    return {
      success: false,
      selectedAnchor: null,
      selectedRate: null,
      attempts: [...previousAttempts, rejectionAttempt],
      finalError: 'No valid quotes from remaining anchors',
    }
  }

  // Sort by totalReceived (descending)
  validQuotes.sort((a, b) => {
    const aTotal = a.quote?.totalReceived ?? 0
    const bTotal = b.quote?.totalReceived ?? 0
    return bTotal - aTotal
  })

  const bestQuote = validQuotes[0]
  const selectedAnchor = await getResolvedAnchorById(bestQuote.anchorId)

  const fallbackAttempt: SolveAttempt = {
    attemptNumber: previousAttempts.length + 2,
    selectedAnchorId: bestQuote.anchorId,
    selectedAnchorName: bestQuote.anchorName,
    quote: bestQuote.quote,
    error: null,
    timestamp: new Date().toISOString(),
  }

  return {
    success: true,
    selectedAnchor,
    selectedRate: bestQuote.quote,
    attempts: [...previousAttempts, rejectionAttempt, fallbackAttempt],
    finalError: null,
  }
/**
 * lib/router/solve.ts
 *
 * Intent router — picks the best anchor for a corridor/amount pair and
 * handles quote rejection with up to MAX_FALLBACK_ATTEMPTS re-solves.
 *
 * Issue #215: fallback re-solve when first anchor rejects quote.
 */

import { fetchAllAnchorFees, computeRateComparison } from '@/lib/stellar/sep24'
import type { AnchorRate, RateComparison } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of fallback re-solve attempts after the primary anchor fails. */
export const MAX_FALLBACK_ATTEMPTS = 2

// ─── Types ────────────────────────────────────────────────────────────────────

/** Reason a quote was rejected or expired. */
export type QuoteRejectionReason = 'expired' | 'rejected' | 'unavailable'

/** A single solve attempt recorded for reputation tracking. */
export interface SolveAttempt {
  /** The anchor that was tried. */
  anchorId: string
  /** Whether this attempt succeeded (quote accepted) or failed. */
  succeeded: boolean
  /** Populated when the attempt failed. */
  rejectionReason?: QuoteRejectionReason
  /** ISO timestamp of the attempt. */
  attemptedAt: string
}

/** The result returned by solveWithFallback. */
export interface SolveResult {
  /** The winning anchor rate, or null if all candidates failed. */
  winner: AnchorRate | null
  /** Full rate comparison from the final successful solve, or null. */
  comparison: RateComparison | null
  /** Ordered log of every attempt made (primary + fallbacks). */
  attempts: SolveAttempt[]
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetches rates for the given corridor/amount and returns the best anchor
 * excluding any anchor IDs in `excludeIds`.
 */
async function fetchBestRate(
  corridorId: string,
  amount: string,
  excludeIds: Set<string>
): Promise<{ winner: AnchorRate; comparison: RateComparison } | null> {
  const settled = await fetchAllAnchorFees(amount, corridorId)

  // Filter out previously-rejected anchors
  const filtered = settled.map((result): PromiseSettledResult<AnchorRate> => {
    if (result.status === 'fulfilled' && excludeIds.has(result.value.anchorId)) {
      return { status: 'rejected', reason: new Error(`Anchor ${result.value.anchorId} excluded`) }
    }
    return result
  })

  const comparison = computeRateComparison(filtered, corridorId)

  if (!comparison.bestRateId) return null

  const winner = comparison.rates.find((r) => r.anchorId === comparison.bestRateId)
  if (!winner) return null

  return { winner, comparison }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Solves for the best anchor for a given corridor and amount.
 *
 * If the primary anchor's quote is rejected or expires, re-solves with the
 * remaining candidates. At most MAX_FALLBACK_ATTEMPTS (2) fallback attempts
 * are made. All attempts are logged for reputation tracking.
 *
 * @param corridorId  - e.g. 'usdc-ngn'
 * @param amount      - amount in USDC as a string, e.g. '100'
 * @param isRejected  - optional predicate; given the winning AnchorRate, returns
 *                      true if the quote should be treated as rejected/expired.
 *                      Defaults to always accepting the quote.
 * @returns SolveResult with winner, comparison, and full attempt log.
 */
export async function solveWithFallback(
  corridorId: string,
  amount: string,
  isRejected: (rate: AnchorRate) => boolean = () => false
): Promise<SolveResult> {
  const attempts: SolveAttempt[] = []
  const excludeIds = new Set<string>()

  // Primary attempt + up to MAX_FALLBACK_ATTEMPTS fallbacks
  const maxRounds = 1 + MAX_FALLBACK_ATTEMPTS

  for (let round = 0; round < maxRounds; round++) {
    const result = await fetchBestRate(corridorId, amount, excludeIds)

    if (!result) {
      // No more candidates available
      break
    }

    const { winner, comparison } = result
    const rejected = isRejected(winner)

    attempts.push({
      anchorId: winner.anchorId,
      succeeded: !rejected,
      ...(rejected && { rejectionReason: 'rejected' as QuoteRejectionReason }),
      attemptedAt: new Date().toISOString(),
    })

    if (!rejected) {
      // Quote accepted — return immediately
      return { winner, comparison, attempts }
    }

    // Exclude this anchor from subsequent rounds
    excludeIds.add(winner.anchorId)
  }

  // All attempts exhausted
  return { winner: null, comparison: null, attempts }
}
