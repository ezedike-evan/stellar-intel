import { describe, it, expect } from 'vitest';
import {
  TARGET_CORRIDORS,
  RATE_DECIMALS,
  deriveCorridorRate,
  deriveAllCorridorRates,
} from '@/lib/oracle/corridor-rate';
import type { OutcomeLogRow } from '@/types/reputation';

function outcome(corridor: string, deliveredRate: string | null): OutcomeLogRow {
  return {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor,
    quotedRate: '1650',
    deliveredRate,
    quotedAmount: '100',
    deliveredAmount: deliveredRate ? '165000' : null,
    settleSeconds: 42,
    outcome: 'completed',
    createdAt: '2026-07-01T00:00:00.000Z',
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
  };
}

describe('deriveCorridorRate (#810)', () => {
  it('scales the median delivered rate to 10^7 and counts the sample', () => {
    const outcomes = [
      outcome('usdc-ngn', '1600'),
      outcome('usdc-ngn', '1650.5'),
      outcome('usdc-ngn', '1700'),
    ];
    const result = deriveCorridorRate('usdc-ngn', outcomes);
    expect(result).not.toBeNull();
    // median of 1600, 1650.5, 1700 is 1650.5 → 16505000000
    expect(result?.rate).toBe(16505000000n);
    expect(result?.decimals).toBe(RATE_DECIMALS);
    expect(result?.sampleCount).toBe(3);
  });

  it('ignores outcomes for other corridors and those not yet settled', () => {
    const outcomes = [
      outcome('usdc-ngn', '1650'),
      outcome('usdc-kes', '129'),
      outcome('usdc-ngn', null), // unsettled — no delivered rate
    ];
    const result = deriveCorridorRate('usdc-ngn', outcomes);
    expect(result?.sampleCount).toBe(1);
    expect(result?.rate).toBe(16500000000n);
  });

  it('returns null when a corridor has no settled data', () => {
    expect(deriveCorridorRate('usdc-mxn', [outcome('usdc-ngn', '1650')])).toBeNull();
  });
});

describe('deriveAllCorridorRates (#810)', () => {
  it('covers only the target corridors that have settled data', () => {
    const outcomes = [
      outcome('usdc-ngn', '1650'),
      outcome('usdc-kes', '129'),
      outcome('usdc-php', '58'),
      outcome('usdc-zar', '18'), // not a target corridor
    ];
    const rates = deriveAllCorridorRates(outcomes);
    const corridors = rates.map((r) => r.corridor).sort();
    expect(corridors).toEqual(['usdc-kes', 'usdc-ngn', 'usdc-php']);
  });

  it('targets exactly the six USDC corridors', () => {
    expect([...TARGET_CORRIDORS]).toEqual([
      'usdc-ngn',
      'usdc-kes',
      'usdc-mxn',
      'usdc-php',
      'usdc-brl',
      'usdc-ars',
    ]);
  });
});
