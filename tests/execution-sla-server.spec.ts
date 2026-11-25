import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchCorridorSettleSummaries } from '@/lib/reputation/execution-sla-server';
import {
  createReputationStore,
  _setReputationStore,
  type ReputationStore,
} from '@/lib/reputation/store';
import { makeOutcomeRow } from './fixtures/outcome-rows';

const NOW = Date.parse('2026-06-04T12:00:00.000Z');

let store: ReputationStore;

beforeEach(() => {
  store = createReputationStore({ backend: 'memory' });
  _setReputationStore(store);
});

afterEach(() => {
  _setReputationStore(null);
  vi.restoreAllMocks();
});

describe('fetchCorridorSettleSummaries (#2150)', () => {
  it('returns empty map for empty store', async () => {
    const res = await fetchCorridorSettleSummaries('usdc-brl', NOW);
    expect(res.size).toBe(0);
  });

  it('aggregates p95 settle times for anchors with >= 30 completed samples in a single query', async () => {
    const querySpy = vi.spyOn(store, 'query');

    // 30 moneygram rows on usdc-brl
    for (let i = 0; i < 30; i++) {
      await store.append(
        makeOutcomeRow({
          intentHash: `mg-${i}`.padStart(64, '0'),
          anchorId: 'moneygram',
          corridor: 'usdc-brl',
          settleSeconds: 60 + i,
          createdAt: new Date(NOW - 3600_000).toISOString(),
          outcome: 'completed',
          attested: true,
        })
      );
    }

    // 10 latamex rows on usdc-brl (below 30 sample threshold)
    for (let i = 0; i < 10; i++) {
      await store.append(
        makeOutcomeRow({
          intentHash: `latam-${i}`.padStart(64, '0'),
          anchorId: 'latamex',
          corridor: 'usdc-brl',
          settleSeconds: 30,
          createdAt: new Date(NOW - 3600_000).toISOString(),
          outcome: 'completed',
          attested: true,
        })
      );
    }

    // 30 rows on a different corridor (should be filtered out by query)
    for (let i = 0; i < 30; i++) {
      await store.append(
        makeOutcomeRow({
          intentHash: `other-${i}`.padStart(64, '0'),
          anchorId: 'cowrie',
          corridor: 'usdc-ngn',
          settleSeconds: 40,
          createdAt: new Date(NOW - 3600_000).toISOString(),
          outcome: 'completed',
          attested: true,
        })
      );
    }

    const summaries = await fetchCorridorSettleSummaries('usdc-brl', NOW);

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledWith({
      corridor: 'usdc-brl',
      direction: 'withdraw',
    });

    expect(summaries.has('moneygram')).toBe(true);
    expect(summaries.has('latamex')).toBe(false);
    expect(summaries.has('cowrie')).toBe(false);

    const mgSummary = summaries.get('moneygram')!;
    expect(mgSummary.sampleSize).toBe(30);
    expect(mgSummary.p95Ms).toBeGreaterThan(0);
  });
});
