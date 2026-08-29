import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateCycle,
  executeCycle,
  compareDecimals,
  computeSlippageBps,
  MAX_CONSECUTIVE_SKIPS,
} from '@/lib/recurring/scheduler';
import {
  initRecurringStore,
  registerRecurringIntent,
  getRecurringIntent,
  getExecutions,
  updateRecurringIntent,
} from '@/lib/recurring/store';
import { RecurringIntentSchema } from '@/types/recurring';
import type { RecurringIntent, CycleEvaluationInput } from '@/types/recurring';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-07-01T12:00:00.000Z');
const PAST = new Date('2026-06-30T12:00:00.000Z');

function makeRecurringIntent(overrides?: Partial<RecurringIntent>): RecurringIntent {
  return RecurringIntentSchema.parse({
    id: 'ri-001',
    corridorId: 'usdc-ngn',
    amount: '500',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ01234567890123456789012345678',
    recipient: 'NG-BANK-12345',
    cadence: 'daily',
    maxSlippageBps: 200,
    rateFloor: '0',
    createdAt: PAST.toISOString(),
    nextExecutionAt: PAST.toISOString(), // Immediately due
    status: 'active',
    ...overrides,
  });
}

function makeQuotes(
  count: number = 1,
  overrides?: Partial<CycleEvaluationInput['quotes'][number]>
): CycleEvaluationInput['quotes'] {
  const base = {
    anchorId: 'cowrie',
    anchorName: 'Cowrie',
    buyAmount: '750000',
    price: '1500.00',
    fee: { total: '2.00' },
    expiresAt: new Date(NOW.getTime() + 300000).toISOString(), // 5 min from now
    quoteId: 'quote-001',
    ...overrides,
  };

  if (count === 1) return [base];

  return [
    base,
    {
      ...base,
      anchorId: 'moneygram',
      anchorName: 'MoneyGram',
      buyAmount: '760000',
      price: '1520.00',
      quoteId: 'quote-002',
    },
  ];
}

// ─── compareDecimals ──────────────────────────────────────────────────────────

describe('compareDecimals', () => {
  it('returns 1 when a > b', () => {
    expect(compareDecimals('100', '50')).toBe(1);
  });

  it('returns -1 when a < b', () => {
    expect(compareDecimals('50', '100')).toBe(-1);
  });

  it('returns 0 when equal', () => {
    expect(compareDecimals('100', '100')).toBe(0);
  });

  it('handles decimal strings', () => {
    expect(compareDecimals('1500.50', '1500.00')).toBe(1);
    expect(compareDecimals('1500.00', '1500.50')).toBe(-1);
  });

  it('handles NaN gracefully', () => {
    expect(compareDecimals('abc', '100')).toBe(-1);
    expect(compareDecimals('100', 'abc')).toBe(1);
    expect(compareDecimals('abc', 'xyz')).toBe(0);
  });
});

// ─── computeSlippageBps ──────────────────────────────────────────────────────

describe('computeSlippageBps', () => {
  it('returns 0 when rates are equal', () => {
    expect(computeSlippageBps('1500', '1500')).toBe(0);
  });

  it('computes slippage for a 1% drop', () => {
    // 1% of 1500 = 15. |1485 - 1500| / 1500 * 10000 = 100 bps
    expect(computeSlippageBps('1485', '1500')).toBe(100);
  });

  it('computes slippage for a 2% drop', () => {
    expect(computeSlippageBps('1470', '1500')).toBe(200);
  });

  it('handles zero reference rate', () => {
    expect(computeSlippageBps('1500', '0')).toBe(0);
  });

  it('handles NaN input', () => {
    expect(computeSlippageBps('abc', '1500')).toBe(0);
    expect(computeSlippageBps('1500', 'xyz')).toBe(0);
  });
});

// ─── evaluateCycle (pure function) ────────────────────────────────────────────

describe('evaluateCycle', () => {
  describe('happy path: execute', () => {
    it('returns execute action with the best quote', () => {
      const ri = makeRecurringIntent();
      const quotes = makeQuotes(2);

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.action).toBe('execute');
        expect(result.anchorId).toBe('moneygram'); // best rate
        expect(result.rate).toBe('1520.00');
        expect(result.netAmount).toBe('760000');
        expect(result.nextExecutionAt).toBeDefined();
      }
    });

    it('selects the quote with highest buy amount', () => {
      const ri = makeRecurringIntent();
      const quotes = [
        makeQuotes(1, { anchorId: 'a', buyAmount: '100000', price: '200' })[0]!,
        makeQuotes(1, { anchorId: 'b', buyAmount: '200000', price: '400' })[0]!,
        makeQuotes(1, { anchorId: 'c', buyAmount: '150000', price: '300' })[0]!,
      ];

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.anchorId).toBe('b');
        expect(result.netAmount).toBe('200000');
      }
    });

    it('computes next execution based on cadence', () => {
      const ri = makeRecurringIntent({ cadence: 'weekly' });
      const quotes = makeQuotes(1);

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // weekly: 7 days from NOW
        const next = new Date(result.nextExecutionAt);
        const expected = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
        expect(next.toISOString()).toBe(expected.toISOString());
      }
    });
  });

  describe('lifecycle: stop date passed', () => {
    it('returns complete when stop date is passed', () => {
      const pastStop = new Date(NOW.getTime() - 86400000).toISOString(); // 1 day ago
      const ri = makeRecurringIntent({ stopDate: pastStop });
      const quotes = makeQuotes(1);

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(false);
      if (!result.ok && result.action === 'complete') {
        expect(result.reason).toBe('stop_date_passed');
      }
    });
  });

  describe('lifecycle: max cycles reached', () => {
    it('returns complete when max cycles reached', () => {
      const ri = makeRecurringIntent({ maxCycles: 3, executedCycles: 3 });
      const quotes = makeQuotes(1);

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(false);
      if (!result.ok && result.action === 'complete') {
        expect(result.reason).toBe('max_cycles_reached');
      }
    });

    it('allows execution when under max cycles', () => {
      const ri = makeRecurringIntent({ maxCycles: 3, executedCycles: 2 });
      const quotes = makeQuotes(1);

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(true);
    });
  });

  describe('lifecycle: non-active status', () => {
    it('returns complete for paused intents', () => {
      const ri = makeRecurringIntent({ status: 'paused' });
      const result = evaluateCycle({ recurringIntent: ri, quotes: makeQuotes(1), now: NOW });

      expect(result.ok).toBe(false);
      if (!result.ok && result.action === 'complete') {
        expect(result.reason).toBe('expired');
      }
    });

    it('returns complete for completed intents', () => {
      const ri = makeRecurringIntent({ status: 'completed' });
      const result = evaluateCycle({ recurringIntent: ri, quotes: makeQuotes(1), now: NOW });

      expect(result.ok).toBe(false);
      if (!result.ok && result.action === 'complete') {
        expect(result.reason).toBe('expired');
      }
    });
  });

  describe('skip: no anchors available', () => {
    it('skips when quotes array is empty', () => {
      const ri = makeRecurringIntent();

      const result = evaluateCycle({ recurringIntent: ri, quotes: [], now: NOW });

      expect(result.ok).toBe(false);
      if (!result.ok && result.action === 'skip') {
        expect(result.reason).toBe('no_anchors_available');
      }
    });
  });

  describe('skip: all quotes expired', () => {
    it('skips when all quotes have expired', () => {
      const ri = makeRecurringIntent();
      const pastExpiry = new Date(NOW.getTime() - 60000).toISOString();
      const quotes = makeQuotes(2, { expiresAt: pastExpiry });

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(false);
      if (!result.ok && result.action === 'skip') {
        expect(result.reason).toBe('all_quotes_expired');
      }
    });
  });

  describe('skip: rate floor', () => {
    it('skips when best rate is below the floor', () => {
      const ri = makeRecurringIntent({ rateFloor: '2000.00' }); // high floor
      const quotes = makeQuotes(1, { price: '1500.00' });

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(false);
      if (!result.ok && result.action === 'skip') {
        expect(result.reason).toBe('rate_out_of_range');
      }
    });

    it('executes when rate meets the floor exactly', () => {
      const ri = makeRecurringIntent({ rateFloor: '1500.00' });
      const quotes = makeQuotes(1, { price: '1500.00' });

      const result = evaluateCycle({ recurringIntent: ri, quotes, now: NOW });

      expect(result.ok).toBe(true);
    });
  });

  describe('skip: slippage exceeded', () => {
    it('skips when slippage exceeds maxSlippageBps', () => {
      // Reference rate is 1000, best quote is 1500 → 50% slippage = 5000 bps
      const ri = makeRecurringIntent({ maxSlippageBps: 200 }); // max 2% slippage
      const quotes = makeQuotes(1, { price: '1500.00' });

      const result = evaluateCycle({
        recurringIntent: ri,
        quotes,
        referenceRate: '1000.00',
        now: NOW,
      });

      expect(result.ok).toBe(false);
      if (!result.ok && result.action === 'skip') {
        expect(result.reason).toBe('slippage_exceeded');
      }
    });

    it('executes when slippage is within bounds', () => {
      const ri = makeRecurringIntent({ maxSlippageBps: 200 });
      const quotes = makeQuotes(1, { price: '1015.00' });

      // 1.5% slippage = 150 bps, which is under 200 bps max
      const result = evaluateCycle({
        recurringIntent: ri,
        quotes,
        referenceRate: '1000.00',
        now: NOW,
      });

      expect(result.ok).toBe(true);
    });
  });
});

// ─── executeCycle (stateful) ──────────────────────────────────────────────────

describe('executeCycle', () => {
  beforeEach(() => {
    initRecurringStore();
  });

  it('executes and updates the store counters', () => {
    const ri = makeRecurringIntent();
    registerRecurringIntent(ri);
    const quotes = makeQuotes(1);

    const result = executeCycle('ri-001', quotes, undefined, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe('execute');
    }

    const updated = getRecurringIntent('ri-001');
    expect(updated?.executedCycles).toBe(1);
    expect(updated?.skippedCycles).toBe(0);

    const history = getExecutions('ri-001');
    expect(history.length).toBe(1);
    expect(history[0]?.status).toBe('executed');
    expect(history[0]?.anchorId).toBe('cowrie');
  });

  it('skips and increments skippedCycles', () => {
    const ri = makeRecurringIntent({ rateFloor: '10000.00' }); // impossible floor
    registerRecurringIntent(ri);
    const quotes = makeQuotes(1, { price: '1500.00' });

    const result = executeCycle('ri-001', quotes, undefined, NOW);

    expect(result.ok).toBe(false);

    const updated = getRecurringIntent('ri-001');
    expect(updated?.skippedCycles).toBe(1);
    expect(updated?.executedCycles).toBe(0);

    const history = getExecutions('ri-001');
    expect(history.length).toBe(1);
    expect(history[0]?.status).toBe('skipped');
    expect(history[0]?.skipReason).toBe('rate_out_of_range');
  });

  it('completes when max cycles reached', () => {
    const ri = makeRecurringIntent({ maxCycles: 1, executedCycles: 1 });
    registerRecurringIntent(ri);
    const quotes = makeQuotes(1);

    const result = executeCycle('ri-001', quotes, undefined, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok && result.action === 'complete') {
      expect(result.reason).toBe('max_cycles_reached');
    }

    const updated = getRecurringIntent('ri-001');
    expect(updated?.status).toBe('completed');
  });

  it('returns complete for unknown intent id', () => {
    const result = executeCycle('nonexistent', makeQuotes(1), undefined, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok && result.action === 'complete') {
      expect(result.reason).toBe('expired');
      expect(result.message).toContain('not found');
    }
  });

  it('returns skip when intent is not yet due', () => {
    const futureExec = new Date(NOW.getTime() + 86400000).toISOString();
    const ri = makeRecurringIntent({ nextExecutionAt: futureExec });
    registerRecurringIntent(ri);

    const result = executeCycle('ri-001', makeQuotes(1), undefined, NOW);

    // Should still be skipped because not due
    expect(result.ok).toBe(false);
  });

  it('auto-pauses after MAX_CONSECUTIVE_SKIPS consecutive skips', () => {
    const ri = makeRecurringIntent({ rateFloor: '100000.00' }); // impossible floor
    registerRecurringIntent(ri);
    const quotes = makeQuotes(1, { price: '1500.00' });

    // Execute MAX_CONSECUTIVE_SKIPS times, resetting nextExecutionAt each time
    // since each execution advances it to the next schedule slot
    for (let i = 0; i < MAX_CONSECUTIVE_SKIPS; i++) {
      // Reset nextExecutionAt to ensure each call passes the isDue check
      updateRecurringIntent('ri-001', { nextExecutionAt: PAST.toISOString() });
      executeCycle('ri-001', quotes, undefined, NOW);
    }

    const updated = getRecurringIntent('ri-001');
    expect(updated?.status).toBe('paused');
  });
});
