import { describe, test, expect } from 'vitest';
import { aggregate, OutcomeRow, Window } from '../lib/reputation/aggregate';

describe('outlier filtering', () => {
  const now = Date.now();
  const baseRows: OutcomeRow[] = [];
  // normal settlement times 100-190 ms
  for (let i = 0; i < 10; i++) {
    baseRows.push({
      intentHash: `hash${i}`,
      anchorId: 'anchor1',
      filled: true,
      settleMs: 100 + i * 10,
      slippage: 0.01,
      recordedAt: now - i * 1000,
    });
  }
  // extreme outlier
  const outlier: OutcomeRow = {
    intentHash: 'outlier',
    anchorId: 'anchor1',
    filled: true,
    settleMs: 2000,
    slippage: 0.02,
    recordedAt: now,
  };
  const rows = [...baseRows, outlier];

  const result = aggregate(rows, 7 as Window, now);

  test('outlier is marked trimmed', () => {
    expect(outlier.trimmed).toBe(true);
  });

  test('p95 does not include outlier (within 5% tolerance)', () => {
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    // Expected p95 from normal data is around 190
    expect(result.settleMs.p95).toBeLessThanOrEqual(200);
    // Ensure outlier value is not used
    expect(result.settleMs.p95).not.toBe(2000);
  });
});
