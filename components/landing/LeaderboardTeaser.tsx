import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { CORRIDORS } from '@/constants';
import { Leaderboard } from '@/components/offramp/Leaderboard';

const TEASER_ROW_LIMIT = 3;

/**
 * Landing-page teaser for the live anchor leaderboard: reuses the same
 * `Leaderboard` component the /anchors page renders (real SEP-38 quotes via
 * `useAnchorRates`), capped to the top rows for a default corridor, with a
 * link through to the full leaderboard.
 */
export function LeaderboardTeaser() {
  const corridor = CORRIDORS[0];
  if (!corridor) return null;

  return (
    <section aria-labelledby="leaderboard-teaser-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="leaderboard-teaser-heading" className="text-lg font-semibold text-primary-text">
            Anchor leaderboard
          </h2>
          <p className="mt-1 text-sm text-secondary-text">
            Live payout ranking for {corridor.from} → {corridor.to}, updated every 30s.
          </p>
        </div>
        <Link
          href="/anchors"
          className="text-secondary-text hover:text-primary-text focus-visible:ring-accent focus-visible:ring-offset-background inline-flex min-h-11 items-center gap-1 rounded-sm font-mono text-xs tracking-wide underline underline-offset-4 transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          See full leaderboard
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <Leaderboard corridor={corridor} limit={TEASER_ROW_LIMIT} />
    </section>
  );
}
