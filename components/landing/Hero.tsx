import Link from 'next/link';
import { Zap } from 'lucide-react';

export function Hero() {
  return (
    <section
      className="flex flex-col items-center justify-center bg-gradient-to-br from-background via-bg-subtle to-background py-20 text-center sm:py-28 dark:from-background dark:via-bg-subtle dark:to-background space-y-6"
      aria-labelledby="hero-heading"
    >
      <div className="inline-flex items-center gap-2 rounded-full bg-accent-subtle px-4 py-1.5 text-sm font-medium text-accent dark:bg-accent-subtle dark:text-accent">
        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
        Stellar Execution Layer
      </div>
      <h1
        id="hero-heading"
        className="max-w-4xl text-4xl font-bold tracking-tight leading-tight text-primary-text dark:text-primary-text sm:text-5xl lg:text-6xl"
      >
        The execution layer for
        <br className="hidden sm:block" />
        <span className="text-accent dark:text-accent">stablecoin off-ramps.</span>
      </h1>
      <p className="mx-auto max-w-2xl text-lg text-secondary-text dark:text-secondary-text sm:text-xl">
        Compare live SEP-38 quotes across every Stellar anchor, then settle a non-custodial USDC
        off-ramp to Nigeria, Kenya, Ghana, Mexico, and more — in a single signed intent.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
        <Link
          href="/offramp"
          className="inline-flex h-12 items-center justify-center rounded-lg bg-blue-600 px-6 text-base font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-700 dark:focus-visible:ring-blue-500"
        >
          Off-ramp now
        </Link>
        <Link
          href="/anchors"
          className="inline-flex h-12 items-center justify-center rounded-lg bg-gray-100 px-6 text-base font-medium text-gray-900 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          View anchors
        </Link>
      </div>
    </section>
  );
}
