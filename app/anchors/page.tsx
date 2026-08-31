/**
 * app/anchors/page.tsx
 *
 * Anchor registry page — lists every registered anchor, its scorecard, and
 * the live corridor leaderboard.
 *
 * Previously `'use client'`.  Converted to a React Server Component so that
 * Dataset JSON-LD markup can be injected with a coverage window derived from
 * the real underlying data (requirement: coverage window must be computed from
 * actual data, not hardcoded).
 *
 * The interactive corridor-filter and leaderboard live in AnchorsContent, which
 * is still a client component — the 'use client' boundary is now at the
 * component level rather than the page level.
 */

import { ANCHORS } from '@/constants';
import { AnchorsContent } from '@/components/anchors/AnchorsContent';
import { buildDatasetJsonLd, serializeJsonLd } from '@/lib/seo/jsonld';
import { loadCorpusCoverage } from '@/lib/reputation/coverage';

export const revalidate = 300; // 5 minutes, matching /anchors/standings

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

export default async function AnchorsPage() {
  // Derive coverage window from real outcome data so the JSON-LD is accurate.
  // loadCorpusCoverage returns null coverage when the store is unavailable
  // (dev / prerender) — the JSON-LD omits temporalCoverage in that case.
  const coverage = await loadCorpusCoverage(ANCHORS.map((a) => a.id));

  const jsonLd = buildDatasetJsonLd({
    url: `${SITE_URL}/anchors`,
    name: 'Stellar Anchor Reputation Corpus — Registry',
    description:
      'Public health and reputation records for Stellar off-ramp anchors registered with Stellar Intel. ' +
      'Includes fill rate, settlement time (p50), and slippage (p50) derived from on-chain settled transactions, ' +
      `covering ${ANCHORS.length} registered anchors across all supported corridors.`,
    temporalCoverage: coverage.temporalCoverage,
    totalSamples: coverage.totalSamples,
    // The probe cycle and leaderboard both refresh every 5 minutes.
    updateFrequency: 'PT5M',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    dateModified: new Date().toISOString(),
  });

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import { ANCHORS, CORRIDORS } from '@/constants';
import { AnchorCard } from '@/components/anchors/AnchorCard';
import { Leaderboard } from '@/components/offramp/Leaderboard';

function AnchorsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const corridorParam = searchParams.get('corridor');
  const activeCorridor = CORRIDORS.find((c) => c.id === corridorParam) ?? CORRIDORS[0];

  const selectCorridor = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('corridor', id);
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // CORRIDORS is a non-empty constant, so this never triggers — it narrows
  // `activeCorridor` from `Corridor | undefined` to `Corridor` for the type checker.
  if (!activeCorridor) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Anchor Leaderboard</h1>
      </header>

      <section aria-label="Filter leaderboard by corridor" className="mb-8">
        <div className="flex flex-wrap gap-2">
          {CORRIDORS.map((corridor) => {
            const selected = corridor.id === activeCorridor.id;
            return (
              <button
                key={corridor.id}
                type="button"
                onClick={() => selectCorridor(corridor.id)}
                aria-pressed={selected}
                className={
                  selected
                    ? 'rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white'
                    : 'rounded-full border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
                }
              >
                {corridor.from}/{corridor.to}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-16" aria-labelledby="anchor-scorecards-heading">
        <h2 id="anchor-scorecards-heading" className="text-fg-muted font-mono text-xs tracking-wide">
          scorecards
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {ANCHORS.map((anchor) => (
            <AnchorCard key={anchor.id} anchor={anchor} />
          ))}
        </div>
      </section>

      <section className="mt-24" aria-labelledby="corridor-leaderboard-heading">
        <h2 id="corridor-leaderboard-heading" className="type-title">
          Corridor leaderboard
        </h2>
        <p className="text-secondary-text measure mt-4 text-base">
          Ranked on a $100 USDC reference amount, refreshed every 30 seconds. An anchor that does
          not answer is listed as unavailable rather than dropped.
        </p>

        <Leaderboard corridor={activeCorridor} />
      </section>
    </div>
  );
}

export default function AnchorsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-8" />}>
      <AnchorsContent />
    </>
  );
}
