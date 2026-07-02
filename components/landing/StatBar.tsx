import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** A single headline statistic rendered in the landing stat bar. */
export interface Stat {
  /** Icon shown beside the value. */
  icon: LucideIcon;
  /** Large primary value (e.g. a count). */
  value: ReactNode;
  /** Caption shown under the value. */
  label: string;
}

/**
 * Landing stat bar — a row of headline statistics.
 *
 * Extracted from app/page.tsx and made data-driven so the stats can be sourced
 * dynamically (#B074). Lays the stats out in a responsive grid: stacked on
 * mobile, evenly spread across the row from `sm` up. With a single stat it still
 * reads as one figure.
 */
export function StatBar({ stats }: { stats: Stat[] }) {
  return (
    <section className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 sm:grid-cols-3">
      {stats.map(({ icon: Icon, value, label }) => (
        <div key={label} className="flex items-center gap-3">
          <Icon className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
          <div>
            <div className="text-xl font-bold text-gray-900 dark:text-white">{value}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
          </div>
        </div>
      ))}
    </section>
  );
}
