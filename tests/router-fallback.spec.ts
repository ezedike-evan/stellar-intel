/**
 * tests/router-fallback.spec.ts
 *
 * Tests for lib/router/solve.ts — issue #215
 * Verifies fallback re-solve behaviour when the primary anchor rejects a quote.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { solveWithFallback, MAX_FALLBACK_ATTEMPTS } from '@/lib/router/solve'
import * as sep24 from '@/lib/stellar/sep24'
import type { AnchorRate, RateComparison } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRate(anchorId: string, totalReceived: number): AnchorRate {
  return {
    anchorId,
    anchorName: `Anchor ${anchorId}`,
    corridorId: 'usdc-ngn',
    fee: 2,
    feeType: 'flat',
    exchangeRate: 1580,
    totalReceived,
    source: 'sep24-fee',
    updatedAt: new Date(),
  }
}

function makeSettled(rate: AnchorRate): PromiseFulfilledResult<AnchorRate> {
  return { status: 'fulfilled', value: rate }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('solveWithFallback — happy path', () => {
  it('returns the best anchor when the primary quote is accepted', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue([
      makeSettled(rateA),
      makeSettled(rateB),
    ])

    const result = await solveWithFallback('usdc-ngn', '100')

    expect(result.winner?.anchorId).toBe('anchor-a')
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0]?.succeeded).toBe(true)
    expect(result.attempts[0]?.anchorId).toBe('anchor-a')
  })

  it('records a single attempt with no rejectionReason on success', async () => {
    const rate = makeRate('anchor-a', 15800)
    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue([makeSettled(rate)])

    const result = await solveWithFallback('usdc-ngn', '100')

    expect(result.attempts[0]?.rejectionReason).toBeUndefined()
  })

  it('returns the full RateComparison alongside the winner', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue([
      makeSettled(rateA),
      makeSettled(rateB),
    ])

    const result = await solveWithFallback('usdc-ngn', '100')

    expect(result.comparison).not.toBeNull()
    expect(result.comparison?.bestRateId).toBe('anchor-a')
    expect(result.comparison?.rates).toHaveLength(2)
  })
})

// ─── Fallback behaviour ───────────────────────────────────────────────────────

describe('solveWithFallback — fallback on rejection', () => {
  it('re-solves with the next best anchor when the primary is rejected', async () => {
    const rateA = makeRate('anchor-a', 15800) // best, but will be rejected
    const rateB = makeRate('anchor-b', 14000) // fallback

    // First call: both anchors available
    // Second call: anchor-a excluded, only anchor-b returned
    vi.spyOn(sep24, 'fetchAllAnchorFees')
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])

    // Reject anchor-a's quote
    const result = await solveWithFallback(
      'usdc-ngn',
      '100',
      (rate) => rate.anchorId === 'anchor-a'
    )

    expect(result.winner?.anchorId).toBe('anchor-b')
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0]?.anchorId).toBe('anchor-a')
    expect(result.attempts[0]?.succeeded).toBe(false)
    expect(result.attempts[0]?.rejectionReason).toBe('rejected')
    expect(result.attempts[1]?.anchorId).toBe('anchor-b')
    expect(result.attempts[1]?.succeeded).toBe(true)
  })

  it('user sees a single unified result — only the winner is surfaced', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    vi.spyOn(sep24, 'fetchAllAnchorFees')
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])

    const result = await solveWithFallback(
      'usdc-ngn',
      '100',
      (rate) => rate.anchorId === 'anchor-a'
    )

    // The winner is a single AnchorRate — not an array of attempts
    expect(result.winner).not.toBeNull()
    expect(Array.isArray(result.winner)).toBe(false)
    expect(result.winner?.anchorId).toBe('anchor-b')
  })

  it('logs both attempts for reputation tracking', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    vi.spyOn(sep24, 'fetchAllAnchorFees')
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])

    const result = await solveWithFallback(
      'usdc-ngn',
      '100',
      (rate) => rate.anchorId === 'anchor-a'
    )

    // Both attempts are logged
    expect(result.attempts).toHaveLength(2)
    const anchorIds = result.attempts.map((a) => a.anchorId)
    expect(anchorIds).toContain('anchor-a')
    expect(anchorIds).toContain('anchor-b')

    // Each attempt has an ISO timestamp
    for (const attempt of result.attempts) {
      expect(() => new Date(attempt.attemptedAt)).not.toThrow()
      expect(new Date(attempt.attemptedAt).toISOString()).toBe(attempt.attemptedAt)
    }
  })

  it('excludes the rejected anchor from the fallback solve', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    const fetchSpy = vi.spyOn(sep24, 'fetchAllAnchorFees')
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])

    await solveWithFallback('usdc-ngn', '100', (rate) => rate.anchorId === 'anchor-a')

    // fetchAllAnchorFees is called twice (primary + 1 fallback)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

// ─── MAX_FALLBACK_ATTEMPTS cap ────────────────────────────────────────────────

describe('solveWithFallback — max fallback attempts', () => {
  it('stops after MAX_FALLBACK_ATTEMPTS fallbacks even if more anchors exist', async () => {
    // Three anchors: all will be rejected
    const rates = [
      makeRate('anchor-a', 15800),
      makeRate('anchor-b', 14000),
      makeRate('anchor-c', 12000),
    ]

    // Each call returns all three; the solver excludes previously-rejected ones
    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue(rates.map(makeSettled))

    // Reject every anchor
    const result = await solveWithFallback('usdc-ngn', '100', () => true)

    // 1 primary + MAX_FALLBACK_ATTEMPTS fallbacks = 3 total rounds max
    expect(result.attempts.length).toBeLessThanOrEqual(1 + MAX_FALLBACK_ATTEMPTS)
    expect(result.winner).toBeNull()
  })

  it('MAX_FALLBACK_ATTEMPTS is 2', () => {
    expect(MAX_FALLBACK_ATTEMPTS).toBe(2)
  })

  it('makes exactly 1 + MAX_FALLBACK_ATTEMPTS calls when all anchors reject', async () => {
    const rates = [
      makeRate('anchor-a', 15800),
      makeRate('anchor-b', 14000),
      makeRate('anchor-c', 12000),
    ]

    const fetchSpy = vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue(rates.map(makeSettled))

    await solveWithFallback('usdc-ngn', '100', () => true)

    expect(fetchSpy).toHaveBeenCalledTimes(1 + MAX_FALLBACK_ATTEMPTS)
  })
})

// ─── No candidates ────────────────────────────────────────────────────────────

describe('solveWithFallback — no candidates', () => {
  it('returns null winner when no anchors are available', async () => {
    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue([])

    const result = await solveWithFallback('usdc-ngn', '100')

    expect(result.winner).toBeNull()
    expect(result.comparison).toBeNull()
    expect(result.attempts).toHaveLength(0)
  })

  it('returns null winner when all anchor fetches are rejected', async () => {
    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue([
      { status: 'rejected', reason: new Error('timeout') },
      { status: 'rejected', reason: new Error('network error') },
    ])

    const result = await solveWithFallback('usdc-ngn', '100')

    expect(result.winner).toBeNull()
    expect(result.comparison).toBeNull()
    expect(result.attempts).toHaveLength(0)
  })

  it('returns null winner when all candidates are exhausted after fallbacks', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    // Only two anchors; both get rejected
    vi.spyOn(sep24, 'fetchAllAnchorFees').mockResolvedValue([
      makeSettled(rateA),
      makeSettled(rateB),
    ])

    const result = await solveWithFallback('usdc-ngn', '100', () => true)

    expect(result.winner).toBeNull()
    expect(result.attempts.every((a) => !a.succeeded)).toBe(true)
  })
})

// ─── Attempt log integrity ────────────────────────────────────────────────────

describe('solveWithFallback — attempt log integrity', () => {
  it('each attempt has anchorId, succeeded, and attemptedAt fields', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    vi.spyOn(sep24, 'fetchAllAnchorFees')
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])

    const result = await solveWithFallback(
      'usdc-ngn',
      '100',
      (rate) => rate.anchorId === 'anchor-a'
    )

    for (const attempt of result.attempts) {
      expect(typeof attempt.anchorId).toBe('string')
      expect(typeof attempt.succeeded).toBe('boolean')
      expect(typeof attempt.attemptedAt).toBe('string')
    }
  })

  it('failed attempts carry a rejectionReason; successful ones do not', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    vi.spyOn(sep24, 'fetchAllAnchorFees')
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])

    const result = await solveWithFallback(
      'usdc-ngn',
      '100',
      (rate) => rate.anchorId === 'anchor-a'
    )

    const failed = result.attempts.filter((a) => !a.succeeded)
    const succeeded = result.attempts.filter((a) => a.succeeded)

    expect(failed.every((a) => a.rejectionReason !== undefined)).toBe(true)
    expect(succeeded.every((a) => a.rejectionReason === undefined)).toBe(true)
  })

  it('attempts are ordered chronologically (primary first)', async () => {
    const rateA = makeRate('anchor-a', 15800)
    const rateB = makeRate('anchor-b', 14000)

    vi.spyOn(sep24, 'fetchAllAnchorFees')
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])
      .mockResolvedValueOnce([makeSettled(rateA), makeSettled(rateB)])

    const result = await solveWithFallback(
      'usdc-ngn',
      '100',
      (rate) => rate.anchorId === 'anchor-a'
    )

    // Primary attempt is anchor-a (highest totalReceived), fallback is anchor-b
    expect(result.attempts[0]?.anchorId).toBe('anchor-a')
    expect(result.attempts[1]?.anchorId).toBe('anchor-b')
  })
})
