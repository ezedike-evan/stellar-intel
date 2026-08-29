import { describe, it, expect, beforeEach } from 'vitest';
import {
  initRecurringStore,
  registerRecurringIntent,
  getRecurringIntent,
  updateRecurringIntent,
  setRecurringIntentStatus,
  listRecurringIntents,
  listDueIntents,
  deleteRecurringIntent,
  recordExecution,
  getExecutions,
  getLatestExecution,
  recurringIntentCount,
  executionCount,
} from '@/lib/recurring/store';
import type { RecurringIntent, RecurringExecution } from '@/types/recurring';
import { RecurringIntentSchema } from '@/types/recurring';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = '2026-07-01T12:00:00.000Z';
const NEXT_EXEC = '2026-07-02T12:00:00.000Z';

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
    createdAt: NOW,
    nextExecutionAt: NEXT_EXEC,
    status: 'active',
    ...overrides,
  });
}

function makeExecution(overrides?: Partial<RecurringExecution>): RecurringExecution {
  return {
    id: 'exec-001',
    recurringIntentId: 'ri-001',
    cycleNumber: 1,
    scheduledAt: NEXT_EXEC,
    attemptedAt: NOW,
    status: 'executed',
    anchorId: 'cowrie',
    anchorName: 'Cowrie',
    quoteId: 'quote-001',
    executedRate: '1500.50',
    netAmount: '750250',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Recurring Intent Store', () => {
  beforeEach(() => {
    initRecurringStore();
  });

  describe('registerRecurringIntent', () => {
    it('registers a new recurring intent', () => {
      const ri = makeRecurringIntent();
      const result = registerRecurringIntent(ri);

      expect(result.ok).toBe(true);
      expect(recurringIntentCount()).toBe(1);
    });

    it('rejects duplicate ids', () => {
      const ri = makeRecurringIntent();
      registerRecurringIntent(ri);
      const result = registerRecurringIntent(ri);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('already exists');
      }
    });

    it('stores a copy, not the original reference', () => {
      const ri = makeRecurringIntent();
      registerRecurringIntent(ri);

      // Mutating the original should not affect the stored copy
      ri.amount = '999';
      const stored = getRecurringIntent('ri-001');
      expect(stored?.amount).toBe('500');
    });
  });

  describe('getRecurringIntent', () => {
    it('returns the stored intent', () => {
      const ri = makeRecurringIntent();
      registerRecurringIntent(ri);

      const stored = getRecurringIntent('ri-001');
      expect(stored).toBeDefined();
      expect(stored?.id).toBe('ri-001');
      expect(stored?.corridorId).toBe('usdc-ngn');
    });

    it('returns undefined for unknown id', () => {
      const stored = getRecurringIntent('nonexistent');
      expect(stored).toBeUndefined();
    });

    it('returns a copy, not the original reference', () => {
      const ri = makeRecurringIntent();
      registerRecurringIntent(ri);

      const stored = getRecurringIntent('ri-001');
      stored!.amount = '999';

      // The stored value should not have changed
      const storedAgain = getRecurringIntent('ri-001');
      expect(storedAgain?.amount).toBe('500');
    });
  });

  describe('updateRecurringIntent', () => {
    it('updates specific fields', () => {
      const ri = makeRecurringIntent();
      registerRecurringIntent(ri);

      const updated = updateRecurringIntent('ri-001', {
        amount: '750',
        status: 'paused',
      });

      expect(updated?.amount).toBe('750');
      expect(updated?.status).toBe('paused');
      expect(updated?.corridorId).toBe('usdc-ngn'); // unchanged
    });

    it('returns undefined for unknown id', () => {
      const updated = updateRecurringIntent('nonexistent', { amount: '100' });
      expect(updated).toBeUndefined();
    });
  });

  describe('setRecurringIntentStatus', () => {
    it('sets the status', () => {
      const ri = makeRecurringIntent();
      registerRecurringIntent(ri);

      const updated = setRecurringIntentStatus('ri-001', 'completed');
      expect(updated?.status).toBe('completed');
    });
  });

  describe('listRecurringIntents', () => {
    it('lists all intents with no filter', () => {
      registerRecurringIntent(makeRecurringIntent({ id: 'ri-001' }));
      registerRecurringIntent(makeRecurringIntent({ id: 'ri-002', status: 'paused' }));
      registerRecurringIntent(makeRecurringIntent({ id: 'ri-003', status: 'completed' }));

      const all = listRecurringIntents();
      expect(all.length).toBe(3);
    });

    it('filters by status', () => {
      registerRecurringIntent(makeRecurringIntent({ id: 'ri-001' }));
      registerRecurringIntent(makeRecurringIntent({ id: 'ri-002', status: 'paused' }));

      const active = listRecurringIntents('active');
      expect(active.length).toBe(1);
      expect(active[0]?.id).toBe('ri-001');

      const paused = listRecurringIntents('paused');
      expect(paused.length).toBe(1);
      expect(paused[0]?.id).toBe('ri-002');
    });

    it('returns empty array when store is empty', () => {
      expect(listRecurringIntents()).toEqual([]);
    });
  });

  describe('listDueIntents', () => {
    it('returns active intents whose nextExecutionAt is in the past', () => {
      const pastExec = new Date(Date.now() - 60000).toISOString();
      const futureExec = new Date(Date.now() + 60000).toISOString();

      registerRecurringIntent(makeRecurringIntent({ id: 'ri-001', nextExecutionAt: pastExec }));
      registerRecurringIntent(makeRecurringIntent({ id: 'ri-002', nextExecutionAt: futureExec }));
      registerRecurringIntent(
        makeRecurringIntent({ id: 'ri-003', nextExecutionAt: pastExec, status: 'paused' })
      );

      const due = listDueIntents();
      expect(due.length).toBe(1);
      expect(due[0]?.id).toBe('ri-001');
    });

    it('returns empty when no intents are due', () => {
      const futureExec = new Date(Date.now() + 60000).toISOString();
      registerRecurringIntent(makeRecurringIntent({ id: 'ri-001', nextExecutionAt: futureExec }));

      expect(listDueIntents()).toEqual([]);
    });
  });

  describe('deleteRecurringIntent', () => {
    it('removes the intent from the store', () => {
      registerRecurringIntent(makeRecurringIntent({ id: 'ri-001' }));
      expect(recurringIntentCount()).toBe(1);

      const result = deleteRecurringIntent('ri-001');
      expect(result).toBe(true);
      expect(recurringIntentCount()).toBe(0);
    });

    it('returns false for unknown id', () => {
      expect(deleteRecurringIntent('nonexistent')).toBe(false);
    });
  });
});

// ─── Executions ──────────────────────────────────────────────────────────────

describe('Execution Records', () => {
  beforeEach(() => {
    initRecurringStore();
  });

  describe('recordExecution and getExecutions', () => {
    it('records and retrieves executions', () => {
      const exec = makeExecution();
      recordExecution(exec);

      const history = getExecutions('ri-001');
      expect(history.length).toBe(1);
      expect(history[0]?.id).toBe('exec-001');
      expect(history[0]?.anchorId).toBe('cowrie');
    });

    it('appends multiple executions', () => {
      recordExecution(makeExecution({ id: 'exec-001', cycleNumber: 1 }));
      recordExecution(makeExecution({ id: 'exec-002', cycleNumber: 2 }));

      const history = getExecutions('ri-001');
      expect(history.length).toBe(2);
      expect(history[0]?.cycleNumber).toBe(1);
      expect(history[1]?.cycleNumber).toBe(2);
    });

    it('returns empty array for unknown intent', () => {
      expect(getExecutions('nonexistent')).toEqual([]);
    });

    it('returns sorted by cycle number', () => {
      recordExecution(makeExecution({ id: 'exec-003', cycleNumber: 3 }));
      recordExecution(makeExecution({ id: 'exec-001', cycleNumber: 1 }));
      recordExecution(makeExecution({ id: 'exec-002', cycleNumber: 2 }));

      const history = getExecutions('ri-001');
      expect(history.map((e) => e.cycleNumber)).toEqual([1, 2, 3]);
    });
  });

  describe('getLatestExecution', () => {
    it('returns the last recorded execution', () => {
      recordExecution(makeExecution({ id: 'exec-001', cycleNumber: 1, anchorId: 'anchor-a' }));
      recordExecution(makeExecution({ id: 'exec-002', cycleNumber: 2, anchorId: 'anchor-b' }));

      const latest = getLatestExecution('ri-001');
      expect(latest?.id).toBe('exec-002');
      expect(latest?.anchorId).toBe('anchor-b');
    });

    it('returns undefined when no executions exist', () => {
      expect(getLatestExecution('ri-001')).toBeUndefined();
    });
  });

  describe('executionCount', () => {
    it('counts all executions across all intents', () => {
      recordExecution(makeExecution({ id: 'exec-001' }));
      recordExecution(makeExecution({ id: 'exec-002', cycleNumber: 2 }));

      expect(executionCount()).toBe(2);
    });
  });

  describe('initRecurringStore', () => {
    it('clears all data', () => {
      registerRecurringIntent(makeRecurringIntent());
      recordExecution(makeExecution());

      initRecurringStore();

      expect(recurringIntentCount()).toBe(0);
      expect(executionCount()).toBe(0);
    });
  });
});
