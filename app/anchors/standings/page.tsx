/**
 * app/anchors/standings/page.tsx
 *
 * Reputation standings view (#801) — lets anchors see their own ranking in the
 * leaderboard so the order-flow incentive is visible, not just an internal sort.
 *
 * Data is fetched server-side from the leaderboard API and rendered as a static
 * table. The page revalidates every 5 minutes to stay fresh without blocking
 * the user on each load.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ANCHORS } from '@/constants';
import { AnchorLogo } from '@/components/ui/AnchorLogo';

export const metadata: Metadata = {
  title: 'Anchor Standings — Stellar Intel',
  description:
    'Reputation standings for Stellar anchors. Rankings are based on fill rate, slippage, and settlement time.',
};

export const revalidate = 300; // 5 minutes

// ─── Types ────────────────────────────────────────────────────────────────────

interface StandingsEntry {
  rank: number;
  anchorId: string;
  anchorName: string;
  composite: number;
  fillRate: number;
  settleP50: number;
  slippageP50: number;
  sampleSize: number;
}

// ─── Score helpers ────────────────────────────────────────────────────────────

/**
 * Composite score formula — mirrors app/api/reputation/leaderboard/route.ts.
 *
 *   composite = 0.4 × fill_rate
 *             + 0.3 × (1 − slippage_p50 / 0.05)
 *             + 0.3 × (1 − settle_p50 / 300)
 */
function computeComposite(fillRate: number, settleP50: number, slippageP50: number): number {
  const fillScore = Math.min(1, Math.max(0, fillRate));
  const slippageScore = Math.min(1, Math.max(0, 1 - slippageP50 / 0.05));
  const settleScore = Math.min(1, Math.max(0, 1 - settleP50 / 300));
  const raw = 0.4 * fillScore + 0.3 * slippageScore + 0.3 * settleScore;
  return Math.round(raw * 10_000) / 10_000;
}

function scoreLabel(score: number): { label: string; className: string } {
  if (score >= 0.8)
    return { label: 'Excellent', className: 'text-emerald-700 dark:text-emerald-400' };
  if (score >= 0.6) return { label: 'Good', className: 'text-blue-600 dark:text-blue-400' };
  if (score >= 0.4) return { label: 'Fair', className: 'text-yellow-600 dark:text-yellow-400' };
  return { label: 'Poor', className: 'text-red-600 dark:text-red-400' };
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadStandings(): Promise<StandingsEntry[]> {
  // Import server-only reputation modules dynamically to avoid bundling them
  // into the client. This page is a React Server Component.
  const { buildScorecards, mapOutcomeRows } = await import('@/lib/reputation/aggregate');
  const { getReputationStore } = await import('@/lib/reputation/store');

  const entries = await Promise.all(
    ANCHORS.map(async (anchor) => {
      try {
        // Resolved inside the try: a postgres backend with no SqlExecutor throws
        // here, and at prerender time there is none. Same guard as loadAnchorRows
        // in app/anchors/[id]/page.tsx.
        const rows = await getReputationStore().query({ anchorId: anchor.id });
        const scorecard = buildScorecards(mapOutcomeRows(rows))[30];

        if (scorecard.state !== 'ok') {
          return {
            anchorId: anchor.id,
            anchorName: anchor.name,
            composite: 0,
            fillRate: 0,
            settleP50: 0,
            slippageP50: 0,
            sampleSize: scorecard.sampleSize,
          };
        }

        const fillRate = scorecard.fillRate;
        const settleP50 = scorecard.settleMs.p50 / 1000;
        const slippageP50 = scorecard.slippage.p50;

        return {
          anchorId: anchor.id,
          anchorName: anchor.name,
          composite: computeComposite(fillRate, settleP50, slippageP50),
          fillRate,
          settleP50,
          slippageP50,
          sampleSize: scorecard.sampleSize,
        };
      } catch {
        // Store unavailable in dev — show anchor with zero score rather than crash.
        return {
          anchorId: anchor.id,
          anchorName: anchor.name,
          composite: 0,
          fillRate: 0,
          settleP50: 0,
          slippageP50: 0,
          sampleSize: 0,
        };
      }
    })
  );

  // Sort descending by composite score and assign ranks.
  entries.sort((a, b) => b.composite - a.composite);
  return entries.map((entry, index) => ({ rank: index + 1, ...entry }));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function StandingsPage() {
  const standings = await loadStandings();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">Anchor standings</h1>
          <Link
            href="/anchors"
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            ← All anchors
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Reputation-based ranking for all registered Stellar anchors. Top-ranked anchors receive
          order-flow priority in the routing engine. Rankings update every 5 minutes.
        </p>
      </header>

      {/* Scoring methodology callout */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300">
        <strong>How rankings work:</strong> Composite score = 40% fill rate + 30% slippage (vs. 5%
        ceiling) + 30% settlement speed (vs. 5 min). Higher is better. Anchors with insufficient
        data (fewer than 1 confirmed transaction) show a score of 0.{' '}
        <Link href="/methodology" className="underline">
          Full methodology →
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <caption className="sr-only">Anchor reputation standings</caption>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
              <th
                scope="col"
                className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400"
              >
                Rank
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400"
              >
                Anchor
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
              >
                Score
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
                title="Fraction of transactions that reached completed status"
              >
                Fill rate
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
                title="Median settlement time in seconds"
              >
                Settle (p50)
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
                title="Median slippage between quoted and delivered rate"
              >
                Slippage (p50)
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400"
                title="Number of transactions used to compute this score"
              >
                Samples
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((entry) => {
              const { label, className } = scoreLabel(entry.composite);
              const isTop = entry.rank === 1;

              return (
                <tr
                  key={entry.anchorId}
                  className={
                    isTop
                      ? 'border-t border-amber-200 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/10'
                      : 'border-t border-gray-200 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50'
                  }
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                        entry.rank === 1
                          ? 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-100'
                          : entry.rank <= 3
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {entry.rank}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/anchors/${entry.anchorId}`}
                      className="flex items-center gap-2 group"
                    >
                      <AnchorLogo
                        anchorId={entry.anchorId}
                        anchorName={entry.anchorName}
                        size="sm"
                      />
                      <span className="font-medium text-gray-900 group-hover:underline dark:text-white">
                        {entry.anchorName}
                      </span>
                      {isTop && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          #1 Ranked
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${className}`}>
                      {(entry.composite * 100).toFixed(1)}%
                    </span>
                    <span className={`ml-1.5 text-xs ${className}`}>{label}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    {entry.sampleSize > 0 ? `${(entry.fillRate * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    {entry.sampleSize > 0 ? `${entry.settleP50.toFixed(0)}s` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    {entry.sampleSize > 0 ? `${(entry.slippageP50 * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">
                    {entry.sampleSize}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
        Rankings are based on a 30-day rolling window. Scores reflect only on-chain settled
        transactions recorded in the Stellar Intel reputation store. Anchors with 0 samples have not
        yet had transactions recorded and default to rank-bottom, not disqualified.
      </p>
    </main>
  );
}
