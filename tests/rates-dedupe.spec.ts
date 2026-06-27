import { describe, it, expect } from 'vitest';
import { dedupeByQuoteId } from '@/lib/stellar/rates-engine';
import type { AnchorRate } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createRate(
  anchorId: string,
  updatedAt: Date,
  overrides?: Partial<AnchorRate>
): AnchorRate {
  return {
    anchorId,
    anchorName: `Anchor ${anchorId}`,
    corridorId: 'usdc-ngn',
    fee: 2.5,
    feeType: 'flat',
    exchangeRate: 1580,
    totalReceived: 1000,
    source: 'sep38',
    updatedAt,
    ...overrides,
  };
}

// ─── Synthetic collisions ───────────────────────────────────────────────────────

describe('dedupeByQuoteId', () => {
  it('collapses two anchors proxying the same pool to a single rate', () => {
    const early = createRate('anchor-a', new Date('2026-05-31T10:00:00Z'), { quoteId: 'q-pool-1' });
    const late = createRate('anchor-b', new Date('2026-05-31T10:00:05Z'), { quoteId: 'q-pool-1' });

    const deduped = dedupeByQuoteId([early, late]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.anchorId).toBe('anchor-a');
  });

  it('prefers the earliest-received rate on collision regardless of input order', () => {
    const early = createRate('anchor-a', new Date('2026-05-31T10:00:00Z'), { quoteId: 'q-pool-1' });
    const late = createRate('anchor-b', new Date('2026-05-31T10:00:05Z'), { quoteId: 'q-pool-1' });

    // Later-received rate listed first — earliest-received must still win.
    const deduped = dedupeByQuoteId([late, early]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.anchorId).toBe('anchor-a');
  });

  it('keeps distinct quote ids', () => {
    const rates = [
      createRate('anchor-a', new Date('2026-05-31T10:00:00Z'), { quoteId: 'q-1' }),
      createRate('anchor-b', new Date('2026-05-31T10:00:01Z'), { quoteId: 'q-2' }),
      createRate('anchor-c', new Date('2026-05-31T10:00:02Z'), { quoteId: 'q-3' }),
    ];

    const deduped = dedupeByQuoteId(rates);

    expect(deduped).toHaveLength(3);
    expect(deduped.map((r) => r.quoteId)).toEqual(['q-1', 'q-2', 'q-3']);
  });

  it('collapses a three-way collision to the single earliest rate', () => {
    const rates = [
      createRate('anchor-b', new Date('2026-05-31T10:00:03Z'), { quoteId: 'q-pool-1' }),
      createRate('anchor-a', new Date('2026-05-31T10:00:01Z'), { quoteId: 'q-pool-1' }),
      createRate('anchor-c', new Date('2026-05-31T10:00:05Z'), { quoteId: 'q-pool-1' }),
    ];

    const deduped = dedupeByQuoteId(rates);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.anchorId).toBe('anchor-a');
  });

  it('never dedupes rates without a quote id', () => {
    const rates = [
      createRate('anchor-a', new Date('2026-05-31T10:00:00Z'), { source: 'sep24-fee' }),
      createRate('anchor-b', new Date('2026-05-31T10:00:01Z'), { source: 'sep24-fee' }),
    ];

    const deduped = dedupeByQuoteId(rates);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((r) => r.anchorId)).toEqual(['anchor-a', 'anchor-b']);
  });

  it('preserves order, emitting a collapsed group at its first appearance', () => {
    const rates = [
      createRate('anchor-a', new Date('2026-05-31T10:00:00Z'), { quoteId: 'q-1' }),
      createRate('anchor-b', new Date('2026-05-31T10:00:01Z'), { quoteId: 'q-2' }),
      createRate('anchor-c', new Date('2026-05-31T10:00:02Z'), { quoteId: 'q-1' }), // dup of first
      createRate('anchor-d', new Date('2026-05-31T10:00:03Z')), // no quote id
    ];

    const deduped = dedupeByQuoteId(rates);

    expect(deduped.map((r) => r.anchorId)).toEqual(['anchor-a', 'anchor-b', 'anchor-d']);
  });

  it('breaks updatedAt ties by keeping the incumbent (first seen)', () => {
    const sameTime = new Date('2026-05-31T10:00:00Z');
    const rates = [
      createRate('anchor-a', sameTime, { quoteId: 'q-1' }),
      createRate('anchor-b', sameTime, { quoteId: 'q-1' }),
    ];

    const deduped = dedupeByQuoteId(rates);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.anchorId).toBe('anchor-a');
  });

  it('returns an empty array unchanged', () => {
    expect(dedupeByQuoteId([])).toEqual([]);
  });
});
