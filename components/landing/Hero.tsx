import Link from 'next/link';
import { Zap } from 'lucide-react';

export function Hero() {
  return (
    <section className="py-8 text-center sm:py-12">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
        <Zap className="h-3.5 w-3.5" />
        Stellar Execution Layer
      </div>
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl md:text-5xl">
        Where stablecoin transactions
        <br className="hidden sm:block" />
        <span className="text-blue-600">happen on Stellar.</span>
      </h1>
      <p className="mx-auto max-w-2xl text-lg text-gray-600 dark:text-gray-400">
        Stellar Intel is the execution layer for cross-border stablecoin flows — execute USDC
        off-ramps across anchors for Nigeria, Kenya, Ghana, Mexico, and more in one click.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/offramp"
          className="inline-flex h-12 items-center justify-center rounded-lg bg-blue-600 px-6 text-base font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
