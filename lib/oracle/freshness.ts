/**
 * On-chain freshness tracking for scorecard oracle data.
 *
 * Tracks when the latest aggregate has been mirrored to Soroban and calculates
 * the drift between the aggregate timestamp and the last publisher transaction.
 */

/**
 * Status of the on-chain verification badge.
 * - 'fresh': Aggregate published to chain within last 10 minutes (green)
 * - 'stale': Aggregate published but drift exceeds 10 minutes (amber)
 * - 'unknown': Publisher timestamp not available (neutral)
 */
export type FreshnessStatus = 'fresh' | 'stale' | 'unknown';

export interface FreshnessResult {
  status: FreshnessStatus;
  /** Drift in milliseconds between aggregate and last publisher tx. */
  driftMs: number | null;
  /** ISO string of the last publisher tx timestamp; null if unknown. */
  lastPublisherTxTimestamp: string | null;
  /** ISO string of the aggregate timestamp. */
  aggregateTimestamp: string;
}

/**
 * Threshold for considering an aggregate fresh (10 minutes = 600,000 ms).
 */
const FRESHNESS_THRESHOLD_MS = 10 * 60 * 1_000;

/**
 * Calculate the on-chain freshness status by comparing the aggregate timestamp
 * with the last publisher transaction timestamp.
 *
 * @param aggregateTimestamp ISO string of the aggregate creation time
 * @param lastPublisherTxTimestamp ISO string of last publisher tx, or null if unknown
 * @returns Freshness status and drift information
 */
export function calculateFreshness(
  aggregateTimestamp: string,
  lastPublisherTxTimestamp: string | null
): FreshnessResult {
  const aggregateDate = new Date(aggregateTimestamp);
  if (isNaN(aggregateDate.getTime())) {
    return {
      status: 'unknown',
      driftMs: null,
      lastPublisherTxTimestamp,
      aggregateTimestamp,
    };
  }

  // No publisher timestamp available yet
  if (!lastPublisherTxTimestamp) {
    return {
      status: 'unknown',
      driftMs: null,
      lastPublisherTxTimestamp: null,
      aggregateTimestamp,
    };
  }

  const publisherDate = new Date(lastPublisherTxTimestamp);
  if (isNaN(publisherDate.getTime())) {
    return {
      status: 'unknown',
      driftMs: null,
      lastPublisherTxTimestamp,
      aggregateTimestamp,
    };
  }

  // Calculate drift: how far behind is the publisher from the aggregate
  const driftMs = aggregateDate.getTime() - publisherDate.getTime();

  // If drift is negative, publisher is ahead (shouldn't happen, treat as fresh)
  if (driftMs <= 0) {
    return {
      status: 'fresh',
      driftMs: 0,
      lastPublisherTxTimestamp,
      aggregateTimestamp,
    };
  }

  // Determine status based on threshold
  const status = driftMs <= FRESHNESS_THRESHOLD_MS ? 'fresh' : 'stale';

  return {
    status,
    driftMs,
    lastPublisherTxTimestamp,
    aggregateTimestamp,
  };
}

/**
 * Format drift time for display (e.g., "3m 45s").
 *
 * @param driftMs Drift in milliseconds
 * @returns Formatted string
 */
export function formatDrift(driftMs: number | null): string {
  if (driftMs === null || driftMs < 0) {
    return '—';
  }

  const totalSeconds = Math.floor(driftMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

/**
 * Get the human-readable status label.
 *
 * @param status Freshness status
 * @returns Display label
 */
export function getFreshnessLabel(status: FreshnessStatus): string {
  switch (status) {
    case 'fresh':
      return 'On-chain verified';
    case 'stale':
      return 'On-chain (outdated)';
    case 'unknown':
      return 'Not yet on-chain';
  }
}

/**
 * Get the badge color class for Tailwind styling.
 *
 * @param status Freshness status
 * @returns Tailwind color classes
 */
export function getFreshnessBadgeColor(status: FreshnessStatus): {
  bg: string;
  text: string;
  icon: string;
} {
  switch (status) {
    case 'fresh':
      return {
        bg: 'bg-green-50 dark:bg-green-950/20',
        text: 'text-green-700 dark:text-green-400',
        icon: 'text-green-600 dark:text-green-400',
      };
    case 'stale':
      return {
        bg: 'bg-amber-50 dark:bg-amber-950/20',
        text: 'text-amber-700 dark:text-amber-400',
        icon: 'text-amber-600 dark:text-amber-400',
      };
    case 'unknown':
      return {
        bg: 'bg-gray-50 dark:bg-gray-900/60',
        text: 'text-gray-700 dark:text-gray-400',
        icon: 'text-gray-500 dark:text-gray-400',
      };
  }
}
