import Link from 'next/link';
import { clsx } from 'clsx';
import type {
  AnchorLeaderboardEntry,
  LeaderboardDirection,
  LeaderboardSortKey,
} from '@/lib/reputation';

interface LeaderboardProps {
  entries: AnchorLeaderboardEntry[];
  selectedCorridor: string | null;
  sortKey: LeaderboardSortKey;
  direction: LeaderboardDirection;
}

const COLUMNS: Array<{
  key: LeaderboardSortKey;
  label: string;
  align: 'left' | 'right';
}> = [
  { key: 'composite', label: 'Composite score', align: 'left' },
  { key: 'fillRate', label: 'Fill rate', align: 'right' },
  { key: 'settleP50', label: 'Settle p50', align: 'right' },
  { key: 'slippage', label: 'Slippage', align: 'right' },
];

function formatMetric(entry: AnchorLeaderboardEntry, key: LeaderboardSortKey) {
  switch (key) {
    case 'composite':
      return entry.composite.toFixed(1);
    case 'fillRate':
      return new Intl.NumberFormat('en-US', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(entry.fillRate);
    case 'settleP50':
      return `${entry.settleP50}h`;
    case 'slippage':
      return new Intl.NumberFormat('en-US', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(entry.slippage / 100);
    default:
      return String(entry[key]);
  }
}

function buildSortLink(
  key: LeaderboardSortKey,
  selectedCorridor: string | null,
  currentSort: LeaderboardSortKey,
  currentDirection: LeaderboardDirection
) {
  const nextDirection: LeaderboardDirection =
    currentSort === key ? (currentDirection === 'desc' ? 'asc' : 'desc') : 'desc';
  const search = new URLSearchParams();
  if (selectedCorridor) search.set('corridor', selectedCorridor);
  search.set('sort', key);
  search.set('direction', nextDirection);
  return `/anchors?${search.toString()}`;
}

export function Leaderboard({ entries, selectedCorridor, sortKey, direction }: LeaderboardProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
              Anchor
            </th>
            {COLUMNS.map((column) => {
              const active = column.key === sortKey;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={clsx(
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400',
                    column.align === 'right' ? 'text-right' : 'text-left'
                  )}
                >
                  <Link href={buildSortLink(column.key, selectedCorridor, sortKey, direction)}>
                    <span className="inline-flex items-center gap-2">
                      {column.label}
                      {active ? (
                        <span className="text-gray-500 dark:text-gray-400">
                          {direction === 'asc' ? '↑' : '↓'}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.anchorId} className="border-t border-gray-200 dark:border-gray-700">
              <td className="px-4 py-4 font-medium text-gray-900 dark:text-white">
                {entry.anchorName}
              </td>
              <td className="px-4 py-4 text-right text-gray-700 dark:text-gray-300">
                {formatMetric(entry, 'composite')}
              </td>
              <td className="px-4 py-4 text-right text-gray-700 dark:text-gray-300">
                {formatMetric(entry, 'fillRate')}
              </td>
              <td className="px-4 py-4 text-right text-gray-700 dark:text-gray-300">
                {formatMetric(entry, 'settleP50')}
              </td>
              <td className="px-4 py-4 text-right text-gray-700 dark:text-gray-300">
                {formatMetric(entry, 'slippage')}
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
              >
                No anchors available for this corridor.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
