import type { Metadata } from 'next';
import Link from 'next/link';

const TITLE = 'Page not found — Stellar Intel';
const DESCRIPTION =
  "This route isn't part of Stellar Intel. Find your way back to the anchor directory, live rates, or the docs.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

const LINK_CLASSES =
  'border-control-border text-primary-text hover:bg-bg-subtle focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm border px-5 text-sm font-medium transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <p className="text-accent font-mono text-sm tracking-wide">404</p>
      <h1 className="type-title text-primary-text mt-4">This route doesn&apos;t exist</h1>
      <p className="text-secondary-text measure mx-auto mt-4">
        The page you followed isn&apos;t part of Stellar Intel &mdash; it may have been renamed,
        moved, or never existed. The record itself is still here.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className={LINK_CLASSES}>
          Home
        </Link>
        <Link href="/anchors" className={LINK_CLASSES}>
          Anchors
        </Link>
        <Link href="/docs" className={LINK_CLASSES}>
          Docs
        </Link>
      </div>
    </div>
  );
}
