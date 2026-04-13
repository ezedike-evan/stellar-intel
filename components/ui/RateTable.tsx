'use client';
import { clsx } from 'clsx';
import { Badge } from './Badge';
import { Button } from './Button';
import type { RiskLevel } from '@/types';

export interface RateTableColumn {
  key: string;
  label: string;
  className?: string;
}

export interface RateTableRow {
  id: string;
  cells: Record<string, React.ReactNode>;
  isBest?: boolean;
  isWorst?: boolean;
  isMock?: boolean;
  riskLevel?: RiskLevel;
}

interface RateTableProps {
  columns: RateTableColumn[];
  rows: RateTableRow[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onExecute?: (id: string) => void;
  isLoading?: boolean;
  caption?: string;
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </td>
      ))}
    </tr>
  );
}

export function RateTable({
  columns,
  rows,
  selectedId,
  onSelect,
  onExecute,
  isLoading,
  caption,
}: RateTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        {caption && (
          <caption className="mb-2 text-left text-xs text-gray-500 dark:text-gray-400 px-4 pt-3">
            {caption}
          </caption>
        )}
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  'px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400',
                  col.className
                )}
              >
                {col.label}
              </th>
            ))}
            <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <SkeletonRow key={i} cols={columns.length + 1} />
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + 1}
                className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
              >
                No results found
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const isSelected = row.id === selectedId;
              return (
                <tr
                  key={row.id}
                  className={clsx(
                    'border-b border-gray-100 transition-colors last:border-0 dark:border-gray-800 text-primary-text',
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={clsx(
                        'px-4 py-3',
                        col.key === 'rate' &&
                          row.isBest &&
                          'font-semibold text-green-600 dark:text-green-400',
                        col.key === 'rate' && row.isWorst && 'text-red-500 dark:text-red-400',
                        col.className
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {row.cells[col.key]}
                        {col.key === 'provider' && row.isBest && (
                          <Badge variant="success">Best</Badge>
                        )}
                        {col.key === 'provider' && row.isMock && <Badge variant="mock">Mock</Badge>}
                      </div>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    {isSelected && onExecute ? (
                      <Button size="sm" onClick={() => onExecute(row.id)}>
                        Execute on Stellar
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => onSelect(row.id)}>
                        Select
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
