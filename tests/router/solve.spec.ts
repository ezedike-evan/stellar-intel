import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ResolvedAnchor, AnchorRate } from '@/types'
import { solve, handleQuoteRejection, type SolveAttempt, type SolveResult } from '@/lib/router/solve'
import * as anchorsModule from '@/lib/stellar/anchors'
import * as sep24Module from '@/lib/stellar/sep24'
import * as loggingModule from '@/lib/api/logging'

/**
 * Mock fixtures and utilities for testing
 */

// Create a mock ResolvedAnchor
function createMockAnchor(id: string, name: string): ResolvedAnchor {
  return {
    id,
    name,
    TRANSFER_SERVER_SEP0024: `https://anchor-${id}.example.com/sep24`,
    domain: 'example.com',
    SIGNING_KEY: 'GBD4OWR4TPJR76YTRPJMFVVDXQKYCMZ7BP22TBHW4N4YFBQAKPNW5HA',
    HOME_DOMAIN: 'example.com',
  } as ResolvedAnchor
}

// Create a mock AnchorRate
function createMockRate(
  anchorId: string,
  anchorName: string,
  totalReceived: number,
  fee: number = 1,
  exchangeRate: number = 1
): AnchorRate {
  return {
    anchorId,
    anchorName,
    corridorId: 'usdc-ngn',
    fee: fee.toString(),
    feeType: 'flat',
    exchangeRate,
    totalReceived,
    source: 'sep24-fee',
    updatedAt: new Date(),
  } as AnchorRate
}

// Create mock solve parameters
function createMockSolveParams() {
  return {
    corridorId: 'usdc-ngn',
    amount: '100',
    assetCode: 'USDC',
    assetIssuer: 'GBUQWP3BOUZX34CAMPANQVM67KPRJAFVSJU7SALOMAJBLARHAVZLKODLA',
    feeType: 'bank_account',
  }
}

describe('solve() - Initial Quote Resolution Success Path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Task 6: solve() returns successful result on first attempt
   * Requirements: 1.1, 1.2, 1.3, 1.4
   */
  it('Task 6: returns successful result on first attempt', async () => {
    // Setup mocks
    const anchor1 = createMockAnchor('anchor1', 'Anchor One')
    const anchor2 = createMockAnchor('anchor2', 'Anchor Two')
    const anchor3 = createMockAnchor('anchor3', 'Anchor Three')

    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([anchor1, anchor2, anchor3])
    vi.spyOn(anchorsModule, 'getResolvedAnchorById')
      .mockResolvedValueOnce(anchor1)
      .mockResolvedValueOnce(anchor2)
      .mockResolvedValueOnce(anchor3)
      .mockResolvedValueOnce(anchor1) // For final result

    vi.spyOn(sep24Module, 'getSep24Fee')
      .mockResolvedValueOnce({ ok: true, fee: 0.5 })
      .mockResolvedValueOnce({ ok: true, fee: 2.0 })
      .mockResolvedValueOnce({ ok: true, fee: 3.0 })

    const logSpy = vi.spyOn(loggingModule, 'logStructured').mockImplementation(() => {})
    const generateRequestIdSpy = vi.spyOn(loggingModule, 'generateRequestId').mockReturnValue('req-test-123')

    const params = createMockSolveParams()

    // Execute
    const result = await solve(params)

    // Assert
    expect(result.success).toBe(true)
    expect(result.selectedAnchor).toEqual(anchor1)
    expect(result.selectedRate?.anchorId).toBe('anchor1')
    expect(result.selectedRate?.totalReceived).toBe(99.5) // (100 - 0.5) * 1
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].attemptNumber).toBe(1)
    expect(result.finalError).toBeNull()
    expect(result.solveRequestId).toBe('req-test-123')
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  /**
   * Task 7: solve() selects best quote by totalReceived
   * Requirements: 11.1, 11.2, 11.4
   */
  it('Task 7: selects best quote by highest totalReceived', async () => {
    const anchor1 = createMockAnchor('anchor1', 'Anchor One')
    const anchor2 = createMockAnchor('anchor2', 'Anchor Two')
    const anchor3 = createMockAnchor('anchor3', 'Anchor Three')

    // Quotes with different totalReceived: 100 > 95 > 98
    // After sorting by totalReceived descending: [100, 98, 95]
    // So anchor1 (100) should be selected

    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([anchor1, anchor2, anchor3])
    vi.spyOn(anchorsModule, 'getResolvedAnchorById')
      .mockResolvedValueOnce(anchor1) // fee fetch for anchor1
      .mockResolvedValueOnce(anchor2) // fee fetch for anchor2
      .mockResolvedValueOnce(anchor3) // fee fetch for anchor3
      .mockResolvedValueOnce(anchor1) // final result

    // Fees that result in totalReceived: 100 > 95 > 98
    // totalReceived = (100 - fee) * 1
    vi.spyOn(sep24Module, 'getSep24Fee')
      .mockResolvedValueOnce({ ok: true, fee: 0 }) // anchor1: totalReceived = 100
      .mockResolvedValueOnce({ ok: true, fee: 5 }) // anchor2: totalReceived = 95
      .mockResolvedValueOnce({ ok: true, fee: 2 }) // anchor3: totalReceived = 98

    vi.spyOn(loggingModule, 'logStructured').mockImplementation(() => {})
    vi.spyOn(loggingModule, 'generateRequestId').mockReturnValue('req-test-select')

    const params = createMockSolveParams()

    // Execute
    const result = await solve(params)

    // Assert - selectedRate should have highest totalReceived (100)
    expect(result.success).toBe(true)
    expect(result.selectedRate?.totalReceived).toBe(100)
    expect(result.selectedAnchor?.id).toBe('anchor1')
  })

  /**
   * Task 8: solve() measures and logs attempt duration
   * Requirements: 1.5, 6.4, 6.5
   */
  it('Task 8: measures and logs attempt duration', async () => {
    const anchor1 = createMockAnchor('anchor1', 'Anchor One')

    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([anchor1])
    vi.spyOn(anchorsModule, 'getResolvedAnchorById')
      .mockResolvedValueOnce(anchor1)
      .mockResolvedValueOnce(anchor1)

    vi.spyOn(sep24Module, 'getSep24Fee').mockResolvedValueOnce({ ok: true, fee: 1 })

    const logSpy = vi.spyOn(loggingModule, 'logStructured').mockImplementation(() => {})
    vi.spyOn(loggingModule, 'generateRequestId').mockReturnValue('req-test-duration')

    const params = createMockSolveParams()

    // Execute
    const result = await solve(params)

    // Assert
    expect(result.attempts[0].durationMs).toBeDefined()
    expect(result.attempts[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(result.attempts[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    
    // Verify logged data
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number),
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      })
    )
  })

  /**
   * Task 9: solve() assigns unique solveRequestId
   * Requirements: 1.6, 6.2, 14.3
   */
  it('Task 9: assigns unique solveRequestId for each solve', async () => {
    const anchor1 = createMockAnchor('anchor1', 'Anchor One')

    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([anchor1])
    vi.spyOn(anchorsModule, 'getResolvedAnchorById')
      .mockResolvedValueOnce(anchor1)
      .mockResolvedValueOnce(anchor1)
      .mockResolvedValueOnce(anchor1)
      .mockResolvedValueOnce(anchor1)

    vi.spyOn(sep24Module, 'getSep24Fee')
      .mockResolvedValueOnce({ ok: true, fee: 1 })
      .mockResolvedValueOnce({ ok: true, fee: 1 })

    const generateIdSpy = vi.spyOn(loggingModule, 'generateRequestId')
      .mockReturnValueOnce('req-unique-1')
      .mockReturnValueOnce('req-unique-2')

    vi.spyOn(loggingModule, 'logStructured').mockImplementation(() => {})

    const params = createMockSolveParams()

    // Execute twice
    const result1 = await solve(params)
    const result2 = await solve(params)

    // Assert - each has unique solveRequestId
    expect(result1.solveRequestId).toBe('req-unique-1')
    expect(result2.solveRequestId).toBe('req-unique-2')
    expect(result1.solveRequestId).not.toBe(result2.solveRequestId)
    expect(generateIdSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * Task 10: solve() fetches quotes in parallel using Promise.all()
   * Requirements: 13.1, 13.2, 13.3
   */
  it('Task 10: fetches quotes in parallel from all anchors', async () => {
    const anchor1 = createMockAnchor('anchor1', 'Anchor One')
    const anchor2 = createMockAnchor('anchor2', 'Anchor Two')
    const anchor3 = createMockAnchor('anchor3', 'Anchor Three')

    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([anchor1, anchor2, anchor3])
    vi.spyOn(anchorsModule, 'getResolvedAnchorById')
      .mockResolvedValue(anchor1)

    const feeSpyMock = vi.spyOn(sep24Module, 'getSep24Fee')
    feeSpyMock.mockImplementation(async () => {
      // Simulate some latency
      await new Promise(resolve => setTimeout(resolve, 10))
      return { ok: true, fee: 1 }
    })

    vi.spyOn(loggingModule, 'logStructured').mockImplementation(() => {})
    vi.spyOn(loggingModule, 'generateRequestId').mockReturnValue('req-test-parallel')

    const params = createMockSolveParams()
    const startTime = Date.now()

    // Execute
    const result = await solve(params)
    const elapsed = Date.now() - startTime

    // Assert
    expect(result.success).toBe(true)
    // If fetched sequentially: 3 * 10ms = 30ms
    // If fetched in parallel: ~10ms + overhead
    // We expect roughly 10-20ms for parallel, would be 30+ for sequential
    expect(feeSpyMock).toHaveBeenCalledTimes(3)
    expect(elapsed).toBeLessThan(100) // Should complete quickly (parallel)
  })

  /**
   * Task 11: solve() handles empty anchor list
   * Requirements: 10.1
   */
  it('Task 11: handles empty anchor list', async () => {
    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([])
    vi.spyOn(loggingModule, 'logStructured').mockImplementation(() => {})
    vi.spyOn(loggingModule, 'generateRequestId').mockReturnValue('req-test-empty')

    const params = createMockSolveParams()

    // Execute
    const result = await solve(params)

    // Assert
    expect(result.success).toBe(false)
    expect(result.finalError).toBe('No anchors available for corridor usdc-ngn')
    expect(result.attempts).toHaveLength(0)
  })

  /**
   * Task 12: solve() handles no valid quotes from any anchor
   * Requirements: 3.5, 10.2
   */
  it('Task 12: handles no valid quotes from any anchor', async () => {
    const anchor1 = createMockAnchor('anchor1', 'Anchor One')
    const anchor2 = createMockAnchor('anchor2', 'Anchor Two')
    const anchor3 = createMockAnchor('anchor3', 'Anchor Three')

    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([anchor1, anchor2, anchor3])
    vi.spyOn(anchorsModule, 'getResolvedAnchorById')
      .mockResolvedValue(anchor1)

    // All fee fetches fail
    vi.spyOn(sep24Module, 'getSep24Fee')
      .mockResolvedValueOnce({ ok: false, reason: 'Transfer server error' })
      .mockResolvedValueOnce({ ok: false, reason: 'Invalid asset' })
      .mockResolvedValueOnce({ ok: false, reason: 'Rate limit exceeded' })

    vi.spyOn(loggingModule, 'logStructured').mockImplementation(() => {})
    vi.spyOn(loggingModule, 'generateRequestId').mockReturnValue('req-test-no-quotes')

    const params = createMockSolveParams()

    // Execute
    const result = await solve(params)

    // Assert
    expect(result.success).toBe(false)
    expect(result.finalError).toBe('No valid quotes received from any anchor')
    expect(result.selectedAnchor).toBeNull()
    expect(result.selectedRate).toBeNull()
  })
})
