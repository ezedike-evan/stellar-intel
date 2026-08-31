/**
 * tests/reputation-coverage.spec.ts
 *
 * Unit tests for lib/reputation/coverage.ts — deriveReputationCoverage.
 *
 * Tests the pure helper (loadCorpusCoverage is server-only and tested via
 * integration).
 */

import { describe, expect, it } from 'vitest';
import { deriveReputationCoverage } from '@/lib/reputation/coverage';
import type { OutcomeLogRow } from '@/types/reputation';

// ─── Fixture builder ──────────────────────────────────────────────────────────

function row(overrides: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return {
    intentHash: Math.random().toString(16).slice(2),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    quotedRate: '1500',
    deliveredRate: null,
    quotedAmount: '100',
    deliveredAmount: null,
    settleSeconds: null,
    outcome: 'completed',
    createdAt: '2026-05-01T00:00:00.000Z',
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    ...overrides,
  };
}

// ─── Empty corpus ─────────────────────────────────────────────────────────────

describe('deriveReputationCoverage — empty corpus', () => {
  it('returns null temporalCoverage and zero samples for an empty array', () => {
    const result = deriveReputationCoverage([]);
    expect(result.temporalCoverage).toBeNull();
    expect(result.totalSamples).toBe(0);
  });
});

// ─── Single row ───────────────────────────────────────────────────────────────

describe('deriveReputationCoverage — single row', () => {
  it('sets start and end to the same date when there is only one row', () => {
    const result = deriveReputationCoverage([row({ createdAt: '2026-06-15T12:00:00.000Z' })]);
    expect(result.temporalCoverage).toBe('2026-06-15/2026-06-15');
    expect(result.totalSamples).toBe(1);
  });
});

// ─── Multiple rows ────────────────────────────────────────────────────────────

describe('deriveReputationCoverage — multiple rows', () => {
  it('returns the correct date interval spanning all rows', () => {
    const rows = [
      row({ createdAt: '2026-03-10T08:00:00.000Z' }),
      row({ createdAt: '2026-07-20T20:00:00.000Z' }),
      row({ createdAt: '2026-05-01T00:00:00.000Z' }),
    ];
    const result = deriveReputationCoverage(rows);
    expect(result.temporalCoverage).toBe('2026-03-10/2026-07-20');
    expect(result.totalSamples).toBe(3);
  });

  it('uses YYYY-MM-DD format for both start and end dates', () => {
    const rows = [
      row({ createdAt: '2026-01-01T00:00:00.000Z' }),
      row({ createdAt: '2026-12-31T23:59:59.999Z' }),
    ];
    const result = deriveReputationCoverage(rows);
    expect(result.temporalCoverage).toMatch(/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/);
    expect(result.temporalCoverage).toBe('2026-01-01/2026-12-31');
  });

  it('counts every row in totalSamples regardless of anchor or corridor', () => {
    const rows = [
      row({ anchorId: 'cowrie', corridor: 'usdc-ngn' }),
      row({ anchorId: 'anclap', corridor: 'usdc-ars' }),
      row({ anchorId: 'mykobo', corridor: 'usdc-eur' }),
    ];
    const result = deriveReputationCoverage(rows);
    expect(result.totalSamples).toBe(3);
  });

  it('handles out-of-order timestamps correctly', () => {
    const rows = [
      row({ createdAt: '2026-08-01T00:00:00.000Z' }),
      row({ createdAt: '2026-01-15T00:00:00.000Z' }),
      row({ createdAt: '2026-04-30T00:00:00.000Z' }),
    ];
    const result = deriveReputationCoverage(rows);
    expect(result.temporalCoverage).toBe('2026-01-15/2026-08-01');
  });
});
