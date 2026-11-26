import type { AuthorizationState } from './due';
import type { StandingExecutionRecord } from './authorization-store';
import type { StandingAuthorizationStatus, StandingAuthorizationTerms } from '@/types/recurring';

// ─── Browser helpers for standing orders ─────────────────────────────────────
//
// The ids of the standing orders this browser created, and thin wrappers over
// the /api/recurring routes. No server imports (types only), so the off-ramp
// page and the reminder banner can use it.

export const RECURRING_IDS_STORAGE_KEY = 'si_recurring_ids';

/** The stored standing-order ids, or [] when storage is empty, blocked or corrupt. */
export function loadRecurringIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECURRING_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export interface StandingOrderView {
  id: string;
  termsHash: string;
  terms: StandingAuthorizationTerms;
  status: StandingAuthorizationStatus;
  state: AuthorizationState;
  executions: StandingExecutionRecord[];
}

/** An Error that carries the API's error `code`. */
export class RecurringApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'RecurringApiError';
  }
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok) {
    throw new RecurringApiError(
      body.code ?? `HTTP_${res.status}`,
      body.message ?? `Request failed with status ${res.status}`,
      res.status
    );
  }
  return body as T;
}

/** GET /api/recurring/{id}. Throws a RecurringApiError on a non-2xx answer. */
export async function fetchStandingOrder(id: string): Promise<StandingOrderView> {
  const res = await fetch(`/api/recurring/${encodeURIComponent(id)}`);
  return parseOrThrow<StandingOrderView>(res);
}
