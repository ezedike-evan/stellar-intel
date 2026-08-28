import type { AnchorRate } from '@/types';

export type RateSortKey = 'rate' | 'fee' | 'receive' | 'reputation';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: RateSortKey;
  direction: SortDirection;
}

const FIELD_ACCESSORS: Record<RateSortKey, (rate: AnchorRate) => number | null> = {
  rate: (r) => r.exchangeRate,
  fee: (r) => r.fee,
  receive: (r) => r.totalReceived,
  /**
   * Reputation rank is 1-based where 1 = best. We negate it so that
   * ascending sort (default for reputation) puts rank-1 at the top.
   * Absent reputationRank sorts to the bottom.
   */
  reputation: (r) => (r.reputationRank != null ? -r.reputationRank : null),
};

/** Cycles a column's sort state: unsorted -> ascending -> descending -> unsorted. */
export function nextSortState(current: SortState | null, key: RateSortKey): SortState | null {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

/**
 * Sorts AnchorRate rows by the given column, client-side, over an
 * already-fetched array. Rows with a null value for the sorted field
 * (unavailable anchors) always sort to the bottom regardless of direction.
 */
export function sortRates(rates: AnchorRate[], sort: SortState | null): AnchorRate[] {
  if (!sort) return rates;

  const accessor = FIELD_ACCESSORS[sort.key];
  const sign = sort.direction === 'asc' ? 1 : -1;

  return [...rates].sort((a, b) => {
    const aVal = accessor(a);
    const bVal = accessor(b);
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return (aVal - bVal) * sign;
  });
}

// ─── URL persistence (#731) ────────────────────────────────────────────────────
//
// Sort lived in useState only, so a sorted view could not be linked or shared
// and was lost on reload. These are pure so the encoding is testable without a
// DOM.

/** Query-string parameter carrying the table's sort state. */
export const SORT_PARAM = 'sort';

const SORT_KEYS: readonly RateSortKey[] = ['rate', 'fee', 'receive', 'reputation'];

/** `{ key: 'fee', direction: 'desc' }` -> `'fee:desc'`. Null clears the param. */
export function serializeSort(sort: SortState | null): string | null {
  return sort ? `${sort.key}:${sort.direction}` : null;
}

/**
 * Parses `'fee:desc'` back into a SortState.
 *
 * Returns null for anything unrecognised rather than throwing or guessing — a
 * hand-edited or stale URL should render the default view, not break the table.
 */
export function parseSort(raw: string | null | undefined): SortState | null {
  if (!raw) return null;

  const parts = raw.split(':');
  // Exactly two segments. Destructuring alone would accept 'fee:asc:extra' by
  // ignoring the tail, which is guessing at a malformed input.
  if (parts.length !== 2) return null;

  const [key, direction] = parts;
  if (!SORT_KEYS.includes(key as RateSortKey)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;

  return { key: key as RateSortKey, direction };
}

/** The `aria-sort` value for a column header, given the active sort. */
export function ariaSortFor(
  sort: SortState | null,
  key: RateSortKey
): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}
