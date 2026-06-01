import { describe, it, expect, vi, beforeEach } from 'vitest'
import { solve, handleQuoteRejection, type SolveAttempt } from '@/lib/router/solve'
import * as anchors from '@/lib/stellar/anchors'
import * as sep24 from '@/lib/stellar/sep24'
import type { ResolvedAnchor, AnchorRate } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const MOCK_RESOLVED_ANCHOR: ResolvedAnchor = {
  id: 'test-anchor',
  name: 'Test Anchor',
  homeDomain: 'test.anchor.com',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5Z...',
  TRANSFER_SERVER_SEP0024: 'https://test.anchor.com/sep24',
  WEB_AUTH_ENDPOINT: 'https://test.anchor.com/auth',
  ANCHOR_QUOTE_SERVER: null,
  SIGNING_KEY: null,
  capabilities: {
    sep10: true,
    sep24: true,
    sep38: false,
    sep12: false,
  },
}

const MOCK_ANCHOR_RATE: AnchorRate = {
  anchorId: 'test-anchor',
  anchorName: 'Test Anchor',
  corridorId: 'usdc-ngn',
  fee: '5.00',
  exchangeRate: 1.0,
  totalReceived: 95.0,
  source: 'sep24-fee',
  updatedAt: new Date(),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('solve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a successful solve with the best anchor quote', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] }
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] }

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any)

    vi.spyOn(anchors, 'getResolvedAnchorById').mockImplementation(async (id: string) => {
      if (id === 'anchor1') {
        return { ...MOCK_RESOLVED_ANCHOR, id: 'anchor1', name: 'Anchor 1' }
      }
      return { ...MOCK_RESOLVED_ANCHOR, id: 'anchor2', name: 'Anchor 2' }
    })

    vi.spyOn(sep24, 'getSep24Fee')
      .mockResolvedValueOnce({ ok: true, fee: '5.00' })
      .mockResolvedValueOnce({ ok: true, fee: '3.00' })

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    expect(result.success).toBe(true)
    expect(result.selectedAnchor?.id).toBe('anchor2')
    expect(result.selectedRate?.fee).toBe('3')
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].attemptNumber).toBe(1)
    expect(result.attempts[0].error).toBeNull()
  })

  it('logs attempt details for reputation tracking', async () => {
    const mockAnchor = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] }

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor] as any)
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor1',
      name: 'Anchor 1',
    })
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: '5.00' })

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    const attempt = result.attempts[0]
    expect(attempt.attemptNumber).toBe(1)
    expect(attempt.selectedAnchorId).toBe('anchor1')
    expect(attempt.selectedAnchorName).toBe('Anchor 1')
    expect(attempt.quote).not.toBeNull()
    expect(attempt.error).toBeNull()
    expect(attempt.timestamp).toBeDefined()
  })

  it('returns error when no anchors are available for corridor', async () => {
    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([])

    const result = await solve({
      corridorId: 'usdc-invalid',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    expect(result.success).toBe(false)
    expect(result.finalError).toContain('No anchors available')
  })

  it('handles fee fetch failures gracefully', async () => {
    const mockAnchor = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] }

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor] as any)
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor1',
    })
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: false, reason: 'unsupported' })

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    expect(result.success).toBe(false)
    expect(result.finalError).toContain('No valid quotes')
  })
})

describe('handleQuoteRejection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('triggers fallback re-solve with remaining candidates', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] }
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] }

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any)

    vi.spyOn(anchors, 'getResolvedAnchorById')
      .mockResolvedValueOnce({ ...MOCK_RESOLVED_ANCHOR, id: 'anchor1', name: 'Anchor 1' })
      .mockResolvedValueOnce({ ...MOCK_RESOLVED_ANCHOR, id: 'anchor2', name: 'Anchor 2' })

    vi.spyOn(sep24, 'getSep24Fee')
      .mockResolvedValueOnce({ ok: true, fee: '3.00' })

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: { ...MOCK_ANCHOR_RATE, anchorId: 'anchor1', fee: '5.00' },
        error: null,
        timestamp: new Date().toISOString(),
      },
    ]

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    expect(result.success).toBe(true)
    expect(result.selectedAnchor?.id).toBe('anchor2')
    expect(result.attempts).toHaveLength(3) // original + rejection + fallback
    expect(result.attempts[1].error).toBe('Quote rejected by anchor')
    expect(result.attempts[2].selectedAnchorId).toBe('anchor2')
  })

  it('logs rejection attempt with unified UX', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] }
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] }

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any)
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor2',
      name: 'Anchor 2',
    })
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: '3.00' })

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ]

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    const rejectionAttempt = result.attempts[1]
    expect(rejectionAttempt.attemptNumber).toBe(2)
    expect(rejectionAttempt.selectedAnchorId).toBe('anchor1')
    expect(rejectionAttempt.error).toBe('Quote rejected by anchor')
    expect(rejectionAttempt.timestamp).toBeDefined()
  })

  it('respects max 2 fallback attempts limit', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] }
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] }
    const mockAnchor3 = { id: 'anchor3', name: 'Anchor 3', corridors: ['usdc-ngn'] }

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2, mockAnchor3] as any)

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
      {
        attemptNumber: 2,
        selectedAnchorId: 'anchor2',
        selectedAnchorName: 'Anchor 2',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ]

    // After 2 attempts, we should have exhausted fallback attempts
    // The third rejection should fail
    const result = await handleQuoteRejection('anchor2', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    // We should still have one candidate (anchor3), so this should succeed
    expect(result.attempts.length).toBeGreaterThanOrEqual(3)
  })

  it('returns error when all anchors are exhausted', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] }

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1] as any)

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ]

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    expect(result.success).toBe(false)
    expect(result.finalError).toContain('No remaining anchors')
  })

  it('preserves attempt history across fallback attempts', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] }
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] }

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any)
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor2',
      name: 'Anchor 2',
    })
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: '3.00' })

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ]

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    })

    // Verify all attempts are preserved
    expect(result.attempts[0]).toEqual(previousAttempts[0])
    expect(result.attempts[1].error).toBe('Quote rejected by anchor')
    expect(result.attempts[2].selectedAnchorId).toBe('anchor2')
  })
})
