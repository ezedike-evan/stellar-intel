'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

type ConfidenceLevel = 'low' | 'medium' | 'high';

function getConfidence(n: number): ConfidenceLevel {
  if (n < 30) return 'low';
  if (n < 200) return 'medium';
  return 'high';
}

const CONFIDENCE_TOOLTIP: Record<ConfidenceLevel, string> = {
  low: 'Fewer than 30 data points — treat with caution.',
  medium: 'Between 30 and 199 data points — moderate reliability.',
  high: '200 or more data points — high reliability.',
};

interface ConfidenceDotProps {
  sampleSize: number;
}

export function ConfidenceDot({ sampleSize }: ConfidenceDotProps) {
  const level = getConfidence(sampleSize);
  return (
    <span
      className="group relative inline-flex items-center"
      aria-label={`${level} confidence (n=${sampleSize})`}
    >
      <span
        className={clsx('h-2.5 w-2.5 rounded-full', {
          'bg-red-500': level === 'low',
          'bg-yellow-400': level === 'medium',
          'bg-green-500': level === 'high',
        })}
      />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-700">
        {CONFIDENCE_TOOLTIP[level]} (n={sampleSize})
      </span>
    </span>
  );
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

function isStale(date: Date, thresholdMin = 10): boolean {
  return Date.now() - date.getTime() > thresholdMin * 60000;
}

interface ScorecardCardProps {
  anchorName: string;
  corridorId: string;
  sampleSize: number;
  children?: ReactNode;
  /** When provided, shows a data freshness footer. */
  lastRefresh?: Date;
  onRefresh?: () => void;
}

export function ScorecardCard({
  anchorName,
  corridorId,
  sampleSize,
  children,
  lastRefresh,
  onRefresh,
}: ScorecardCardProps) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!lastRefresh) return;
    const id = setInterval(() => tick((n: number) => n + 1), 30000);
    return () => clearInterval(id);
  }, [lastRefresh]);

  const stale = lastRefresh ? isStale(lastRefresh) : false;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{anchorName}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{corridorId}</p>
        </div>
        <ConfidenceDot sampleSize={sampleSize} />
      </div>
      {children}

      {lastRefresh && (
        <div
          className={`mt-3 flex items-center justify-between border-t pt-2 text-xs ${
            stale
              ? 'border-yellow-200 dark:border-yellow-800'
              : 'border-gray-100 dark:border-gray-700'
          }`}
        >
          <span
            className={
              stale ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-500'
            }
          >
            {stale ? 'Stale — ' : ''}Data as of {formatRelativeTime(lastRefresh)}
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Refresh
            </button>
          )}
        </div>
      )}
    </div>
  );
}
