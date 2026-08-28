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
      className="inline-flex items-center gap-1 font-medium text-secondary-text hover:text-primary-text dark:text-fg-muted dark:hover:text-white"
    >
      {label}
      <span
        className={`text-[10px] leading-none ${direction ? 'text-primary-text' : 'text-secondary-text'}`}
        aria-hidden="true"
      >
        {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}
      </span>
    </button>
  );
}
