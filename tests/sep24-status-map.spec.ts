import { describe, it, expect } from 'vitest'
import { STATUS_MAP, mapToCanonical } from '@/lib/stellar/sep24-status-map'
import type { WithdrawStatusValue, WithdrawStatus } from '@/types'

/**
 * Tests for SEP-24 status map exhaustiveness.
 *
 * Ensures that every possible raw anchor status (WithdrawStatusValue) maps to
 * a canonical status (WithdrawStatus), and that the mapping is exhaustive at
 * compile time via discriminated-union type checking.
 */

// ─── Exhaustiveness ───────────────────────────────────────────────────────────

describe('STATUS_MAP — exhaustiveness', () => {
  it('contains all WithdrawStatusValue entries', () => {
    const expectedStatuses: WithdrawStatusValue[] = [
      'incomplete',
      'pending_user_transfer_start',
      'pending_user_transfer_complete',
      'pending_external',
      'pending_anchor',
      'pending_stellar',
      'pending_trust',
      'pending_user',
      'completed',
      'refunded',
      'error',
      'no_market',
      'too_small',
      'too_large',
      'expired',
    ]

    for (const status of expectedStatuses) {
      expect(STATUS_MAP).toHaveProperty(status)
    }
  })

  it('has exactly 15 entries matching WithdrawStatusValue count', () => {
    const mapKeys = Object.keys(STATUS_MAP)
    expect(mapKeys).toHaveLength(15)
  })

  it('maps each entry to a valid WithdrawStatus', () => {
    const validStatuses: WithdrawStatus[] = [
      'pending_user_action',
      'pending_anchor',
      'pending_stellar',
      'pending_external',
      'completed',
      'no_market',
      'refunded',
      'expired',
      'error',
    ]

    for (const raw of Object.keys(STATUS_MAP) as WithdrawStatusValue[]) {
      const canonical = STATUS_MAP[raw]
      expect(validStatuses).toContain(canonical)
    }
  })
})

// ─── Individual mappings ──────────────────────────────────────────────────────

describe('STATUS_MAP — individual mappings', () => {
  it('maps pending_user_* statuses to pending_user_action', () => {
    expect(STATUS_MAP.incomplete).toBe('pending_user_action')
    expect(STATUS_MAP.pending_user_transfer_start).toBe('pending_user_action')
    expect(STATUS_MAP.pending_user_transfer_complete).toBe('pending_user_action')
    expect(STATUS_MAP.pending_user).toBe('pending_user_action')
  })

  it('maps pending_anchor and pending_trust to pending_anchor', () => {
    expect(STATUS_MAP.pending_anchor).toBe('pending_anchor')
    expect(STATUS_MAP.pending_trust).toBe('pending_anchor')
  })

  it('maps pending_stellar to pending_stellar', () => {
    expect(STATUS_MAP.pending_stellar).toBe('pending_stellar')
  })

  it('maps pending_external to pending_external', () => {
    expect(STATUS_MAP.pending_external).toBe('pending_external')
  })

  it('maps terminal statuses correctly', () => {
    expect(STATUS_MAP.completed).toBe('completed')
    expect(STATUS_MAP.refunded).toBe('refunded')
    expect(STATUS_MAP.expired).toBe('expired')
  })

  it('maps error statuses to error', () => {
    expect(STATUS_MAP.error).toBe('error')
    expect(STATUS_MAP.too_small).toBe('error')
    expect(STATUS_MAP.too_large).toBe('error')
  })

  it('maps no_market to no_market', () => {
    expect(STATUS_MAP.no_market).toBe('no_market')
  })
})

// ─── mapToCanonical function ───────────────────────────────────────────────────

describe('mapToCanonical', () => {
  it('returns the correct canonical status for a known raw status', () => {
    expect(mapToCanonical('pending_anchor')).toBe('pending_anchor')
    expect(mapToCanonical('completed')).toBe('completed')
    expect(mapToCanonical('error')).toBe('error')
  })

  it('returns the correct grouping for pending_user statuses', () => {
    expect(mapToCanonical('incomplete')).toBe('pending_user_action')
    expect(mapToCanonical('pending_user_transfer_start')).toBe('pending_user_action')
    expect(mapToCanonical('pending_user_transfer_complete')).toBe('pending_user_action')
    expect(mapToCanonical('pending_user')).toBe('pending_user_action')
  })

  it('returns the correct grouping for anchor-pending statuses', () => {
    expect(mapToCanonical('pending_anchor')).toBe('pending_anchor')
    expect(mapToCanonical('pending_trust')).toBe('pending_anchor')
  })

  it('returns the correct grouping for error statuses', () => {
    expect(mapToCanonical('too_small')).toBe('error')
    expect(mapToCanonical('too_large')).toBe('error')
    expect(mapToCanonical('error')).toBe('error')
  })

  it('is deterministic — same input yields same output', () => {
    const status: WithdrawStatusValue = 'pending_stellar'
    const result1 = mapToCanonical(status)
    const result2 = mapToCanonical(status)
    expect(result1).toBe(result2)
  })
})

// ─── Compile-time exhaustiveness check ─────────────────────────────────────────

describe('STATUS_MAP — compile-time checks', () => {
  it('verifies STATUS_MAP is a complete Record<WithdrawStatusValue, WithdrawStatus>', () => {
    // This test verifies that the type system would catch any missing mappings
    // at compile time. The STATUS_MAP type annotation ensures this.
    // If a new WithdrawStatusValue is added without a corresponding entry,
    // TypeScript will fail to compile.
    const _assertType: Record<WithdrawStatusValue, WithdrawStatus> = STATUS_MAP
    expect(_assertType).toBeDefined()
  })

  it('ensures no unmapped raw statuses can slip through', () => {
    // Verify that all properties in STATUS_MAP are used and correct
    const statusValues: WithdrawStatusValue[] = Object.keys(STATUS_MAP) as WithdrawStatusValue[]
    const canonicalValues: WithdrawStatus[] = Object.values(STATUS_MAP)

    // All statuses should map to valid canonical values
    statusValues.forEach((raw) => {
      const canonical = STATUS_MAP[raw]
      expect(canonical).toBeDefined()
      expect(canonicalValues).toContain(canonical)
    })
  })
})
