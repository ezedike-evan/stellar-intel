'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reportError } from '@/lib/reporter';

const LINK_CLASSES =
  'border-control-border text-primary-text hover:bg-bg-subtle focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm border px-5 text-sm font-medium transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';

const BUTTON_CLASSES =
  'bg-accent text-background hover:bg-accent/90 focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm px-5 text-sm font-medium transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Next.js strips the stack/message from what reaches the client bundle in
  // production builds, but route it through the same reporter used
  // elsewhere so it still lands in whatever's configured (e.g. Sentry) —
  // never render `error.message` or `error.stack` here.
  useEffect(() => {
    reportError(error, { digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <p className="text-accent font-mono text-sm tracking-wide">Error</p>
      <h1 className="type-title text-primary-text mt-4">Something went wrong</h1>
      <p className="text-secondary-text measure mx-auto mt-4">
        This page hit an unexpected error. It&apos;s been logged &mdash; try again, or head back to
        somewhere that works.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className={BUTTON_CLASSES}>
          Try again
        </button>
        <Link href="/" className={LINK_CLASSES}>
          Home
        </Link>
      </div>
    </div>
  );
}
