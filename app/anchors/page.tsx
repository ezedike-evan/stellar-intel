'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import Link from 'next/link';
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
    <main className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <header>
        <h1 className="type-title">Anchors</h1>
        <p className="text-secondary-text measure mt-4 text-base">
          Every anchor in the registry, what it publishes about itself, and how it has actually
          performed on the corridors it is registered for.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Was a green "N live anchors" pill. Nothing on this page establishes
              that an anchor is live — that is what the probe record decides, and
              a registered anchor with no successful probe is exactly the case
              this product exists to surface. "Registered" is the claim the
              registry can actually support. */}
          <p className="text-fg-muted font-mono text-xs tracking-wide">
            {ANCHORS.length} registered
          </p>
          <Link
            href="/anchors/standings"
            className="text-secondary-text hover:text-primary-text focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm font-mono text-xs tracking-wide underline underline-offset-4 transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            reputation standings &rarr;
          </Link>
        </div>
      </header>

      <section className="mt-16" aria-labelledby="anchor-scorecards-heading">
        <h2
          id="anchor-scorecards-heading"
          className="text-fg-muted font-mono text-xs tracking-wide"
        >
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

        {/* Corridor filter. Square controls, not pills — and the selected one is
            marked by surface and border rather than a filled accent, so the
            accent stays available for the result that matters. */}
        <div
          className="mt-8 flex flex-wrap gap-2"
          role="group"
          aria-label="Filter leaderboard by corridor"
        >
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
                    ? 'border-control-border bg-bg-subtle text-primary-text focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm border px-4 font-mono text-xs tracking-wide focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
                    : 'border-border text-secondary-text hover:text-primary-text hover:border-control-border focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm border px-4 font-mono text-xs tracking-wide transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
                }
              >
                {corridor.from}/{corridor.to}
              </button>
            );
          })}
        </div>

        <div className="mt-8">
          <Leaderboard corridor={activeCorridor} />
        </div>
      </section>
    </main>
  );
}

export default function AnchorsPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-4 py-12 sm:py-16" />}>
      <AnchorsContent />
    </Suspense>
  );
}
