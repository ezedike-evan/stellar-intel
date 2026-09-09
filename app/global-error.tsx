'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/reporter';
import './globals.css';

const LINK_CLASSES =
  'border-control-border text-primary-text hover:bg-bg-subtle inline-flex h-11 items-center rounded-sm border px-5 text-sm font-medium transition-colors duration-100 ease-out';

const BUTTON_CLASSES =
  'bg-accent text-background hover:bg-accent/90 inline-flex h-11 items-center rounded-sm px-5 text-sm font-medium transition-colors duration-100 ease-out';

// Rendered only when the root layout itself throws, so it can't assume
// anything the layout normally provides (ThemeProvider, Header/Footer) is
// mounted — it must own its own <html>/<body> and stay self-contained. It
// still imports globals.css directly so the theme tokens (and dark mode)
// used below resolve the same way they do everywhere else in the app.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-primary-text flex min-h-screen items-center justify-center">
        <div className="mx-auto max-w-2xl px-4 py-24 text-center">
          <p className="text-accent font-mono text-sm tracking-wide">Error</p>
          <h1 className="type-title text-primary-text mt-4">Something went wrong</h1>
          <p className="text-secondary-text measure mx-auto mt-4">
            Stellar Intel hit an unexpected error and couldn&apos;t render this page. It&apos;s been
            logged &mdash; try again.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={reset} className={BUTTON_CLASSES}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error
                replaces the root layout (and its Link-providing router tree) entirely,
                so a plain anchor is the documented Next.js pattern here. */}
            <a href="/" className={LINK_CLASSES}>
              Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
