/**
 * computeRateComparison over hand-built settled results (fulfilled quotes
 * mixed with rejections).
 *
 * Deadline behaviour (solicitAnchorQuotes and SOLICITOR_DEADLINE_MS in
 * lib/stellar/sep24.ts) is tested in tests/parallel-anchor-solicitor.spec.ts.
 */

import { describe, it, expect } from 'vitest';
import { computeRateComparison } from '@/lib/stellar/sep24';
import type { AnchorRate } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRate(
  anchorId: string,
  totalReceived: number,
  overrides?: Partial<AnchorRate>
): AnchorRate {
  return {
    anchorId,
    anchorName: `Anchor ${anchorId}`,
    corridorId: 'usdc-ngn',
    fee: 2.5,
    feeType: 'flat',
    exchangeRate: 1580,
    totalReceived,
    source: 'sep24-fee',
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── computeRateComparison integration ───────────────────────────────────────

describe('multi-anchor racing — computeRateComparison integration', () => {
  it('correctly ranks anchors from a mixed settled result set', () => {
    const results: PromiseSettledResult<AnchorRate>[] = [
      { status: 'fulfilled', value: makeRate('anchor-a', 95_000) },
      { status: 'rejected', reason: new Error('timeout') },
      { status: 'fulfilled', value: makeRate('anchor-c', 98_000) },
      { status: 'rejected', reason: new Error('network error') },
    ];

    const comparison = computeRateComparison(results, 'usdc-ngn');

    expect(comparison.rates).toHaveLength(2);
    expect(comparison.bestRateId).toBe('anchor-c');
  });

  it('preserves rate values exactly through aggregation', () => {
    const rate = makeRate('solo', 123_456.78);
    const results: PromiseSettledResult<AnchorRate>[] = [{ status: 'fulfilled', value: rate }];

    const comparison = computeRateComparison(results, 'usdc-ngn');

    expect(comparison.rates[0]).toStrictEqual(rate);
    expect(comparison.bestRateId).toBe('solo');
  });
});
