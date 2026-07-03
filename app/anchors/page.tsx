'use client';

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
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">Anchors</h1>
          <span
            aria-label={`${ANCHORS.length} live ${ANCHORS.length === 1 ? 'anchor' : 'anchors'}`}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
            {ANCHORS.length} live {ANCHORS.length === 1 ? 'anchor' : 'anchors'}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Explore registered Stellar anchors, their supported protocols, and corridor coverage.
        </p>
      </header>

      <section className="mb-10" aria-labelledby="anchor-scorecards-heading">
        <h2
          id="anchor-scorecards-heading"
          className="mb-4 text-lg font-semibold text-gray-900 dark:text-white"
        >
          Anchor scorecards
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {ANCHORS.map((anchor) => (
            <AnchorCard key={anchor.id} anchor={anchor} />
          ))}
        </div>
      </section>

      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
        Corridor leaderboard
      </h2>

      {/* Corridor filter tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {CORRIDORS.map((corridor) => (
          <button
            key={corridor.id}
            onClick={() => selectCorridor(corridor.id)}
            className={
              corridor.id === activeCorridor.id
                ? 'rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white'
                : 'rounded-full border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
            }
          >
            {corridor.from}/{corridor.to}
          </button>
        ))}
      </div>

      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Rates based on a $100 USDC reference amount. Updated every 30 s.
      </p>

      <Leaderboard corridor={activeCorridor} />
    </main>
  );
}

export default function AnchorsPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-4 py-8" />}>
      <AnchorsContent />
    </Suspense>
  );
}
