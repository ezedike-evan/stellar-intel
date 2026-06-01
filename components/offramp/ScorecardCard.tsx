'use client';
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

interface ScorecardCardProps {
  anchorName: string;
  corridorId: string;
  sampleSize: number;
  children?: React.ReactNode;
}

export function ScorecardCard({ anchorName, corridorId, sampleSize, children }: ScorecardCardProps) {
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
    </div>
  );
}
