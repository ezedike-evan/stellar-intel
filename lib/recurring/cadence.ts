/**
 * lib/recurring/cadence.ts
 *
 * Cadence computation for recurring intents.
 * Translates named cadences and cron expressions into concrete next-execution
 * timestamps and due-check predicates.
 */

import type { Cadence, CadenceNamed } from '@/types/recurring';

// ─── Named cadence intervals ──────────────────────────────────────────────────

const NAMED_INTERVALS: Record<CadenceNamed, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  biweekly: 14 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000, // approximate; exact computation below
};

const NAMED_NAMES: CadenceNamed[] = ['daily', 'weekly', 'biweekly', 'monthly'];

function isNamed(c: Cadence): c is CadenceNamed {
  return NAMED_NAMES.includes(c as CadenceNamed);
}

// ─── Cron field parsing ───────────────────────────────────────────────────────

interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

/**
 * Parse a single cron field into an array of matching values.
 * Supports: *, N, N-M, N/M, N,M,O
 */
function parseCronField(field: string, min: number, max: number): number[] {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const results: number[] = [];
  const parts = field.split(',');

  for (const part of parts) {
    if (part.includes('/')) {
      // Step: N/M, */M, or N-M/M
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr!, 10);
      let rangeVals: number[];
      if (range === '*') {
        rangeVals = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      } else if (range!.includes('-')) {
        const [start, end] = range!.split('-').map(Number);
        rangeVals = [];
        for (let i = start!; i <= end!; i++) {
          rangeVals.push(i);
        }
      } else {
        rangeVals = [parseInt(range!, 10)];
      }
      for (const v of rangeVals) {
        if ((v - min) % step === 0) {
          results.push(v);
        }
      }
    } else if (part.includes('-')) {
      // Range: N-M
      const [start, end] = part.split('-').map(Number);
      for (let i = start!; i <= end!; i++) {
        results.push(i);
      }
    } else {
      results.push(parseInt(part, 10));
    }
  }

  return [...new Set(results)].sort((a, b) => a - b);
}

function parseCron(expression: string): CronFields {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/);
  return {
    minute: parseCronField(minute!, 0, 59),
    hour: parseCronField(hour!, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth!, 1, 31),
    month: parseCronField(month!, 1, 12),
    dayOfWeek: parseCronField(dayOfWeek!, 0, 6), // 0=Sunday
  };
}

function nextCronAfter(fields: CronFields, after: Date): Date {
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1); // start just after 'after'

  const maxIter = 366 * 24 * 60; // safety limit: 1 year of minutes

  for (let i = 0; i < maxIter; i++) {
    const m = candidate.getMonth() + 1;
    const d = candidate.getDate();
    const h = candidate.getHours();
    const min = candidate.getMinutes();
    const dow = candidate.getDay();

    if (
      fields.month.includes(m) &&
      fields.dayOfMonth.includes(d) &&
      fields.hour.includes(h) &&
      fields.minute.includes(min) &&
      fields.dayOfWeek.includes(dow)
    ) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error('Could not compute next cron execution within safety limit');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the next execution timestamp after a given time.
 *
 * @param cadence   The cadence (named or cron expression).
 * @param after     The reference time (defaults to now).
 * @param startAt   Optional origin time for named cadences. If provided, the
 *                  next execution aligns to this start time rather than `after`.
 */
export function computeNextExecutionAt(
  cadence: Cadence,
  after: Date = new Date(),
  startAt?: Date
): Date {
  if (isNamed(cadence)) {
    const intervalMs = NAMED_INTERVALS[cadence];
    const origin = startAt ?? after;

    if (!startAt || origin.getTime() >= after.getTime()) {
      return new Date(origin.getTime() + intervalMs);
    }

    // Find the next aligned time
    const elapsed = after.getTime() - origin.getTime();
    const periods = Math.ceil(elapsed / intervalMs);
    return new Date(origin.getTime() + periods * intervalMs);
  }

  // Cron expression
  const fields = parseCron(cadence);
  return nextCronAfter(fields, after);
}

/**
 * Check whether a recurring intent is due for execution.
 *
 * @param nextExecutionAt  The scheduled next execution time (ISO string or Date).
 * @param now              Current time (defaults to now).
 * @returns true if the intent is due (now >= nextExecutionAt).
 */
export function isDue(nextExecutionAt: string | Date, now: Date = new Date()): boolean {
  const next = typeof nextExecutionAt === 'string' ? new Date(nextExecutionAt) : nextExecutionAt;
  return now.getTime() >= next.getTime();
}

/**
 * Check if a stop date has passed (the recurring intent should be completed).
 */
export function isStopDatePassed(stopDate: string | undefined, now: Date = new Date()): boolean {
  if (!stopDate) return false;
  return now.getTime() >= new Date(stopDate).getTime();
}

/**
 * Check if the maximum number of cycles has been reached.
 */
export function isMaxCyclesReached(
  executedCycles: number,
  maxCycles: number | undefined
): boolean {
  if (maxCycles === undefined) return false;
  return executedCycles >= maxCycles;
}

/**
 * Validate that a cadence string is well-formed.
 */
export function isValidCadence(cadence: string): boolean {
  if (NAMED_NAMES.includes(cadence as CadenceNamed)) return true;

  const cronRegex =
    /^[\d*,\/-]+\s+[\d*,\/-]+\s+[\d*,\/-]+\s+[\d*,\/-]+\s+[\d*,\/-]+$/;
  if (!cronRegex.test(cadence)) return false;

  try {
    parseCron(cadence);
    return true;
  } catch {
    return false;
  }
}
