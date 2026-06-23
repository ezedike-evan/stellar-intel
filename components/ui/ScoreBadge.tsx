import { getScoreBand, getBandLabel } from '@/lib/reputation/bands';

interface ScoreBadgeProps {
  score: number;
  className?: string;
}

export function ScoreBadge({ score, className = '' }: ScoreBadgeProps) {
  const band = getScoreBand(score);
  const label = getBandLabel(band);

  let colors = '';
  let icon = null;

  switch (band) {
    case 'green':
      colors = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      icon = (
        <svg
          className="mr-1.5 h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      );
      break;
    case 'amber':
      colors = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      icon = (
        <svg
          className="mr-1.5 h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      );
      break;
    case 'red':
      colors = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      icon = (
        <svg
          className="mr-1.5 h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      );
      break;
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors} ${className}`}
      title={label}
    >
      {icon}
      {score}%<span className="sr-only"> - {label}</span>
    </span>
  );
}
