/**
 * lib/recurring/index.ts
 *
 * Barrel export for the recurring intents module.
 */

// Types re-exported from @/types/recurring
export type {
  Cadence,
  CadenceNamed,
  RecurringIntent,
  RecurringIntentStatus,
  RecurringAuthorization,
  RecurringExecution,
  RecurringExecutionStatus,
  RecurringSkipReason,
  CycleEvaluationInput,
  CycleEvaluationResult,
} from '@/types/recurring';

export {
  CadenceSchema,
  RecurringIntentSchema,
  RecurringAuthorizationSchema,
} from '@/types/recurring';

// Cadence computation
export {
  computeNextExecutionAt,
  isDue,
  isStopDatePassed,
  isMaxCyclesReached,
  isValidCadence,
} from './cadence';

// Store
export {
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
} from './store';

// Scheduler
export {
  evaluateCycle,
  executeCycle,
  evaluateAllDueIntents,
  compareDecimals,
  computeSlippageBps,
  MAX_CONSECUTIVE_SKIPS,
} from './scheduler';
