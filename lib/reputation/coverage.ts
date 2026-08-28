/**
 * lib/reputation/coverage.ts
 *
 * Derives the actual date-range (temporalCoverage) and total sample count
 * for the anchor reputation corpus from outcome_log rows.
 *
 * Used by the Dataset JSON-LD generators on /anchors and /anchors/standings
 * so the markup always reflects real underlying data rather than hardcoded
 * values.
 */

import type { OutcomeLogRow } from '@/types/reputation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReputationCoverage {
  /**
   * ISO 8601 date-interval string e.g. `"2026-01-15/2026-08-28"`.
   * `null` when there are no rows — the caller must then omit
   * `temporalCoverage` from JSON-LD rather than fabricating one.
   */
  temporalCoverage: string | null;
  /** Total outcome rows spanning the coverage window. */
  totalSamples: number;
}

// ─── Pure helper ──────────────────────────────────────────────────────────────

/**
 * Derives coverage from an array of outcome_log rows.
 *
 * The input may span multiple anchors; anchor and corridor filtering is
 * the caller's responsibility.  An empty array returns `null` coverage and
 * zero samples so the Dataset JSON-LD can omit `temporalCoverage` entirely
 * instead of emitting a meaningless or wrong date range.
 */
export function deriveReputationCoverage(rows: readonly OutcomeLogRow[]): ReputationCoverage {
  if (rows.length === 0) {
    return { temporalCoverage: null, totalSamples: 0 };
  }

  let minMs = Infinity;
  let maxMs = -Infinity;

  for (const row of rows) {
    const ms = new Date(row.createdAt).getTime();
    if (ms < minMs) minMs = ms;
    if (ms > maxMs) maxMs = ms;
  }

  const startDate = new Date(minMs).toISOString().slice(0, 10); // YYYY-MM-DD
  const endDate = new Date(maxMs).toISOString().slice(0, 10);

  return {
    temporalCoverage: `${startDate}/${endDate}`,
    totalSamples: rows.length,
  };
}

// ─── Server helper ────────────────────────────────────────────────────────────

/**
 * Queries the reputation store for **all** anchors and derives the coverage
 * window across the entire corpus.
 *
 * Failures are swallowed per-anchor so a single broken row never prevents
 * the page from rendering — the result simply reflects what was retrievable.
 *
 * Server-only: do not import from client components.
 */
export async function loadCorpusCoverage(anchorIds: string[]): Promise<ReputationCoverage> {
  // Dynamic imports keep the server-only store out of the client bundle.
  const { tryGetReputationStore } = await import('@/lib/reputation/store');
  const store = tryGetReputationStore();

  if (!store) {
    // No durable store configured (dev without DATABASE_URL, prerender).
    return { temporalCoverage: null, totalSamples: 0 };
  }

  const allRows: import('@/types/reputation').OutcomeLogRow[] = [];

  await Promise.all(
    anchorIds.map(async (anchorId) => {
      try {
        const rows = await store.query({ anchorId });
        allRows.push(...rows);
      } catch {
        // Store unavailable for this anchor — skip, don't throw.
      }
    })
  );

  return deriveReputationCoverage(allRows);
}
