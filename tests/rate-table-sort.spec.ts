import { describe, it, expect } from 'vitest';
import { parseSort, serializeSort, ariaSortFor, nextSortState, SORT_PARAM } from '@/lib/sort';

// #731 — sorting worked but was invisible to assistive tech (no aria-sort
// anywhere in the repo) and could not be linked (state lived in useState only).

describe('sort URL encoding (#731)', () => {
  it('round-trips a sort state', () => {
    const sort = { key: 'fee', direction: 'desc' } as const;
    expect(parseSort(serializeSort(sort))).toEqual(sort);
  });

  it('serialises null to null so the param is removed, not set empty', () => {
    // `?sort=` is not the same as no sort — it would round-trip to null anyway,
    // but leaving it litters every shared link.
    expect(serializeSort(null)).toBeNull();
  });

  it('rejects an unknown column instead of guessing', () => {
    expect(parseSort('secretcolumn:asc')).toBeNull();
  });

  it('rejects an unknown direction', () => {
    expect(parseSort('fee:sideways')).toBeNull();
  });

  it('survives a hand-edited or truncated param', () => {
    // A stale link should render the default view, not break the table.
    for (const raw of ['', 'fee', 'fee:', ':asc', 'fee:asc:extra', null, undefined]) {
      expect(parseSort(raw)).toBeNull();
    }
  });

  it('names the query parameter once, for the component to reuse', () => {
    expect(SORT_PARAM).toBe('sort');
  });
});

describe('aria-sort mapping (#731)', () => {
  it('reports none for columns that are not the active sort', () => {
    expect(ariaSortFor({ key: 'fee', direction: 'asc' }, 'rate')).toBe('none');
    expect(ariaSortFor(null, 'rate')).toBe('none');
  });

  it('maps direction to the ARIA token, not the internal one', () => {
    // The internal values are 'asc'/'desc'; ARIA requires
    // 'ascending'/'descending', and a screen reader ignores anything else.
    expect(ariaSortFor({ key: 'fee', direction: 'asc' }, 'fee')).toBe('ascending');
    expect(ariaSortFor({ key: 'fee', direction: 'desc' }, 'fee')).toBe('descending');
  });

  it('tracks the three-state cycle through to unsorted', () => {
    let sort = nextSortState(null, 'rate');
    expect(ariaSortFor(sort, 'rate')).toBe('ascending');

    sort = nextSortState(sort, 'rate');
    expect(ariaSortFor(sort, 'rate')).toBe('descending');

    sort = nextSortState(sort, 'rate');
    expect(sort).toBeNull();
    expect(ariaSortFor(sort, 'rate')).toBe('none');
  });
});
