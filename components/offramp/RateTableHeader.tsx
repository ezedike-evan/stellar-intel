'use client';

import { AnchorCountBadge } from './AnchorCountBadge';

export interface RateTableHeaderProps {
  /** Number of anchors that responded with usable rates. */
  respondingCount: number;
  /** Total number of anchors (responding + errored + pending). */
  totalCount: number;
  /** Timestamp of the last successful SWR revalidation; null before the first fetch. */
  lastFetchedAt: number | null;
  /** Whole seconds remaining until the next SWR revalidation. */
  secondsRemaining: number;
  /** Whole seconds elapsed since the last revalidation. */
  elapsedSeconds: number;
  /** Whether the user has requested reduced motion. */
  prefersReducedMotion: boolean;
  /** Progress through the refresh interval as 0→1. */
  progress: number;
  /** Total duration of the refresh interval in whole seconds. */
  totalSeconds: number;
  /** Whether a manual refresh is currently in flight. */
  refreshInflight: boolean;
  /** Callback to trigger a manual refresh. */
  onRefresh: () => void;
}

/**
 * Header bar above the rate table showing the title, anchor-count badge,
 * a countdown to the next automatic refresh, and a manual refresh button.
 *
 * When `prefers-reduced-motion` is active, the countdown renders as a static
 * "Last updated Xs ago" text instead of an animated progress bar, meeting the
 * WCAG SC 2.3.3 guideline for respecting user animation preferences.
 */
export function RateTableHeader({
  respondingCount,
  totalCount,
  lastFetchedAt,
  secondsRemaining,
  elapsedSeconds,
  prefersReducedMotion,
  progress,
  totalSeconds,
  refreshInflight,
  onRefresh,
}: RateTableHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Available Rates</h2>
        <AnchorCountBadge responding={respondingCount} total={totalCount} />

        {lastFetchedAt !== null && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {prefersReducedMotion ? (
              <span aria-live="polite">Last updated {elapsedSeconds}s ago</span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span aria-live="polite">Rates refresh in ~{secondsRemaining}s</span>
                {/* Visual countdown progress bar — shrinks rightward as time advances.
                    Width goes from 100% (just revalidated) down toward 0% (about to refresh).
                    The transition duration is set to 1s to match the 1s tick interval,
                    producing smooth movement rather than jerky 1s jumps. */}
                <span
                  role="progressbar"
                  aria-label={`${secondsRemaining} seconds until next rate refresh`}
                  aria-valuenow={secondsRemaining}
                  aria-valuemin={0}
                  aria-valuemax={totalSeconds}
                  className="inline-block h-1 w-10 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
                >
                  <span
                    className="block h-full rounded-full bg-blue-500 transition-[width] duration-1000 ease-linear dark:bg-blue-400"
                    style={{
                      width: `${Math.max(0, Math.min(100, (1 - progress) * 100))}%`,
                    }}
                  />
                </span>
              </span>
            )}
          </span>
        )}
      </div>

      <button
        onClick={onRefresh}
        aria-label={refreshInflight ? 'Refreshing rates...' : 'Refresh rates'}
        aria-busy={refreshInflight}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <svg
          className={`h-3.5 w-3.5 ${refreshInflight ? 'animate-spin' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Refresh
        <kbd
          aria-hidden="true"
          className="rounded border border-gray-300 px-1 font-mono text-[10px] font-normal text-gray-400 dark:border-gray-600 dark:text-gray-500"
        >
          R
        </kbd>
      </button>
    </div>
  );
}
