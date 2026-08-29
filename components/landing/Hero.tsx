'use client';

import Link from 'next/link';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import { formatCurrency, formatRate } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';

const HERO_CORRIDOR_ID = 'usdc-ngn';
const HERO_AMOUNT = '100';

/**
 * The hero states the thesis and then immediately shows an instance of it.
 *
 * It is deliberately asymmetric — the argument sits on the left, the artifact
 * on the right, and the space underneath is left empty. A centred headline over
 * a centred subhead over two centred buttons is the most template-shaped
 * composition on the web, and it is what this page had.
 *
 * The accent appears exactly once in this section: on the live figure, not on a
 * button. The colour marks the thing the product produces, which is the whole
 * point of having one accent instead of a palette.
 *
 * The leaderboard that used to sit here was a second copy of the
 * `LeaderboardTeaser` section rendered further down the same page.
 */
export function Hero() {
  const { rates, isLoading } = useAnchorRates(HERO_CORRIDOR_ID, HERO_AMOUNT);
  const bestRate =
    rates?.rates.find((rate) => rate.anchorId === rates.bestRateId) ?? rates?.rates[0] ?? null;
  const loading = isLoading && !rates;

  return (
    <section
      className="grid grid-cols-1 items-start gap-x-6 gap-y-12 py-16 lg:grid-cols-12 lg:py-24"
      aria-labelledby="hero-heading"
    >
      <div className="lg:col-span-7">
        <p className="text-fg-muted mb-6 flex flex-wrap items-center gap-2 font-mono text-xs tracking-wide">
          <span className="bg-control-border inline-block h-px w-6" aria-hidden="true" />
          probed every 5 minutes · 4 signals
        </p>

        {/* Each line is a block rather than a <br />, so a narrow viewport wraps
            within the line instead of overflowing past it. */}
        <h1 id="hero-heading" className="type-display">
          <span className="text-secondary-text block">What anchors say.</span>
          <span className="block">What anchors did.</span>
        </h1>

        <p className="text-secondary-text measure mt-6 text-base sm:text-lg">
          A directory records what an anchor declares about itself, and stays correct until that
          anchor&apos;s deployment changes without the listing changing with it. This is the other
          half: seven registered off-ramp anchors, probed on a clock, with the scoring method
          published and small samples labelled as small.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/anchors"
            className="border-control-border text-primary-text hover:bg-bg-subtle focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm border px-5 text-sm font-medium transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            See the record
          </Link>
          <Link
            href="/methodology"
            className="text-secondary-text hover:text-primary-text focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm px-2 text-sm font-medium transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Read the method &rarr;
          </Link>
        </div>
      </div>

      <div className="lg:col-span-5 lg:col-start-8">
        <div className="border-border bg-bg-subtle rounded-sm border">
          <div className="border-border text-fg-muted flex items-center justify-between border-b px-4 py-3 font-mono text-xs tracking-wide">
            <span>usdc &rarr; ngn</span>
            <span>100.00 USDC</span>
          </div>
          <div className="p-4">
            {loading ? <RatePreviewSkeleton /> : <RatePreview best={bestRate} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function RatePreview({
  best,
}: {
  best: {
    anchorName: string;
    exchangeRate: number | null;
    totalReceived: number | null;
  } | null;
}) {
  if (!best || best.totalReceived === null) {
    return (
      <div className="min-h-[168px]">
        <p className="text-fg-muted font-mono text-xs tracking-wide">best landed value</p>
        <p className="text-secondary-text mt-3 text-sm">
          No anchor is quoting this corridor right now.
        </p>
        <p className="text-fg-muted mt-2 text-sm">
          That is an observation, not a fault on our side — it is exactly the kind of thing this
          record exists to write down.
        </p>
        <Link
          href="/anchors?corridor=usdc-ngn"
          className="text-secondary-text hover:text-primary-text mt-6 inline-block font-mono text-xs tracking-wide underline underline-offset-4"
        >
          see all seven anchors &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[168px]">
      <p className="text-fg-muted font-mono text-xs tracking-wide">best landed value</p>
      {/* The one accent on this screen. */}
      <p className="text-accent mt-2 font-mono text-4xl font-medium tracking-tight tabular-nums">
        {formatCurrency(best.totalReceived, 'NGN')}
      </p>
      <dl className="border-border mt-5 space-y-2 border-t pt-4 font-mono text-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-fg-muted">anchor</dt>
          <dd className="text-secondary-text">{best.anchorName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-fg-muted">rate</dt>
          <dd className="text-secondary-text tabular-nums">
            {best.exchangeRate !== null ? formatRate(best.exchangeRate, 'USDC', 'NGN') : '—'}
          </dd>
        </div>
      </dl>
      <Link
        href="/offramp"
        className="text-secondary-text hover:text-primary-text mt-6 inline-block font-mono text-xs tracking-wide underline underline-offset-4"
      >
        compare all live rates &rarr;
      </Link>
    </div>
  );
}

function RatePreviewSkeleton() {
  return (
    <div className="min-h-[168px]">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-10 w-48" />
      <Skeleton className="mt-6 h-3 w-full" />
      <Skeleton className="mt-3 h-3 w-3/4" />
    </div>
  );
}
