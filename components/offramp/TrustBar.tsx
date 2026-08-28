'use client';

import Link from 'next/link';
import { ANCHORS } from '@/constants/anchors';

/**
 * `docs/NON_CUSTODY.md` has no route — `app/docs/` is a hand-built tree, not a
 * generic markdown renderer — so this points at the file on GitHub rather than
 * at a page that would 404.
 */
const NON_CUSTODY_HREF =
  'https://github.com/ezedike-evan/stellar-intel/blob/main/docs/NON_CUSTODY.md';

/** Older than this and "moments ago" would be a lie. */
const STALE_AFTER_MS = 120_000;

export function formatFreshness(lastFetchedAt: number | null, now: number = Date.now()): string {
  if (lastFetchedAt === null) return 'not yet loaded';

  const seconds = Math.floor((now - lastFetchedAt) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export function isStale(lastFetchedAt: number | null, now: number = Date.now()): boolean {
  return lastFetchedAt !== null && now - lastFetchedAt > STALE_AFTER_MS;
}

interface TrustBarProps {
  /** Epoch ms of the last successful rates fetch, or null before the first. */
  lastFetchedAt: number | null;
}

/**
 * Three things a reader should be able to check before committing funds (#791).
 *
 * Every claim here is one the repository can back. There is deliberately no
 * "audited" badge and no uptime percentage: no audit has been performed, and an
 * uptime figure computed over a short probe window would be a number dressed as
 * evidence. Each item links to the thing that substantiates it, so the bar is
 * checkable rather than reassuring.
 */
export function TrustBar({ lastFetchedAt }: TrustBarProps) {
  const stale = isStale(lastFetchedAt);

  return (
    <section
      aria-label="Trust and transparency"
      className="rounded-xl border border-border bg-bg-subtle px-4 py-3"
    >
      <ul className="grid gap-3 text-xs sm:grid-cols-3 sm:gap-4">
        <li className="flex flex-col gap-0.5">
          <span className="font-medium text-primary-text">Non-custodial</span>
          <span className="text-secondary-text">
            You sign every transaction with your own wallet.{' '}
            <a
              href={NON_CUSTODY_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              How it works
            </a>
          </span>
        </li>

        <li className="flex flex-col gap-0.5">
          <span className="font-medium text-primary-text">{ANCHORS.length} anchors monitored</span>
          <span className="text-secondary-text">
            Scored from observed behaviour.{' '}
            <Link href="/methodology" className="text-accent underline underline-offset-2">
              Methodology
            </Link>
          </span>
        </li>

        <li className="flex flex-col gap-0.5">
          <span className="font-medium text-primary-text">Rates</span>
          <span className="text-secondary-text">
            Updated{' '}
            <time
              // Not a live region: the countdown beside the table already
              // announces refreshes, and two announcements per cycle is noise.
              dateTime={lastFetchedAt ? new Date(lastFetchedAt).toISOString() : undefined}
              data-testid="trust-freshness"
            >
              {formatFreshness(lastFetchedAt)}
            </time>
            {stale && <span className="text-secondary-text"> — may be out of date</span>}
          </span>
        </li>
      </ul>
    </section>
  );
}
