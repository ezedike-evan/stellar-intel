'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import { CORRIDORS } from '@/constants';
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
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-white">Anchor Leaderboard</h1>

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
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-8" />}>
      <AnchorsContent />
    </Suspense>
  );
}
