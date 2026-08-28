/**
 * lib/recurring/store.ts
 *
 * In-memory store for recurring intents and their execution records.
 * Follows the same Map-based pattern as lib/intent/replay.ts.
 *
 * Designed to be swappable for a durable store (SQLite/Postgres) in the future.
 */

import type { RecurringIntent, RecurringIntentStatus, RecurringExecution } from '@/types/recurring';

// ─── Store ────────────────────────────────────────────────────────────────────

const recurringIntents = new Map<string, RecurringIntent>();
const executions = new Map<string, RecurringExecution[]>();

// ─── Recurring Intents ────────────────────────────────────────────────────────

/**
 * Register a new recurring intent (after the user has signed the authorization).
 * Returns an error if an intent with the same id already exists.
 */
export function registerRecurringIntent(
  intent: RecurringIntent
): { ok: true } | { ok: false; error: string } {
  if (recurringIntents.has(intent.id)) {
    return { ok: false, error: `Recurring intent ${intent.id} already exists` };
  }

  recurringIntents.set(intent.id, { ...intent });
  return { ok: true };
}

/**
 * Retrieve a recurring intent by id.
 */
export function getRecurringIntent(id: string): RecurringIntent | undefined {
  const intent = recurringIntents.get(id);
  if (!intent) return undefined;
  return { ...intent };
}

/**
 * Update a recurring intent in-place.
 */
export function updateRecurringIntent(
  id: string,
  updates: Partial<RecurringIntent>
): RecurringIntent | undefined {
  const existing = recurringIntents.get(id);
  if (!existing) return undefined;

  const updated = { ...existing, ...updates };
  recurringIntents.set(id, updated);
  return { ...updated };
}

/**
 * Update the status of a recurring intent.
 */
export function setRecurringIntentStatus(
  id: string,
  status: RecurringIntentStatus
): RecurringIntent | undefined {
  return updateRecurringIntent(id, { status });
}

/**
 * List all recurring intents matching an optional status filter.
 */
export function listRecurringIntents(status?: RecurringIntentStatus): RecurringIntent[] {
  const all = Array.from(recurringIntents.values()).map((r) => ({ ...r }));

  if (!status) return all;
  return all.filter((r) => r.status === status);
}

/**
 * List all active recurring intents that are due for execution.
 */
export function listDueIntents(now: Date = new Date()): RecurringIntent[] {
  return listRecurringIntents('active').filter((r) => {
    const next = new Date(r.nextExecutionAt);
    return next.getTime() <= now.getTime();
  });
}

/**
 * Delete a recurring intent and its execution history.
 */
export function deleteRecurringIntent(id: string): boolean {
  executions.delete(id);
  return recurringIntents.delete(id);
}

// ─── Executions ───────────────────────────────────────────────────────────────

/**
 * Record a new execution for a recurring intent.
 */
export function recordExecution(execution: RecurringExecution): void {
  const history = executions.get(execution.recurringIntentId) ?? [];
  history.push({ ...execution });
  executions.set(execution.recurringIntentId, history);
}

/**
 * Get all execution records for a recurring intent, ordered by cycle number.
 */
export function getExecutions(recurringIntentId: string): RecurringExecution[] {
  const history = executions.get(recurringIntentId);
  if (!history) return [];
  return [...history].sort((a, b) => a.cycleNumber - b.cycleNumber);
}

/**
 * Get the latest execution record for a recurring intent.
 */
export function getLatestExecution(recurringIntentId: string): RecurringExecution | undefined {
  const history = executions.get(recurringIntentId);
  if (!history || history.length === 0) return undefined;
  return { ...history[history.length - 1]! };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Initialize the store. Clears all data. Intended for test setup.
 */
export function initRecurringStore(): void {
  recurringIntents.clear();
  executions.clear();
}

/**
 * Get the total number of recurring intents in the store.
 */
export function recurringIntentCount(): number {
  return recurringIntents.size;
}

/**
 * Get the total number of execution records across all recurring intents.
 */
export function executionCount(): number {
  let total = 0;
  for (const history of executions.values()) {
    total += history.length;
  }
  return total;
}
