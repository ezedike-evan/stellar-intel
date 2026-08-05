'use client';
import type { SortDirection } from '@/lib/sort';

interface SortToggleProps {
  label: string;
  direction: SortDirection | null;
  onClick: () => void;
}

export function SortToggle({ label, direction, onClick }: SortToggleProps) {
  const directionLabel =
    direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'unsorted';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label} (${directionLabel})`}
      className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
    >
      {label}
      <span
        className={`text-[10px] leading-none ${direction ? 'text-gray-700 dark:text-gray-200' : 'text-secondary-text'}`}
        aria-hidden="true"
      >
        {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}
      </span>
    </button>
  );
}
