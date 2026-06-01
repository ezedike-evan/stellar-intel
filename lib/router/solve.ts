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
