'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useCountUp } from '@/hooks/useCountUp';

/** A single headline statistic rendered in the landing stat bar. */
export interface Stat {
  /** Icon shown beside the value. */
  icon: LucideIcon;
  /** Large primary value (e.g. a count). */
  value: ReactNode;
  /** Caption shown under the value. */
  label: string;
}

function AnimatedStatValue({ value }: { value: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const animatedValue = useCountUp({ end: numericValue ?? 0, enabled: hasEnteredViewport });

  useEffect(() => {
    const node = containerRef.current;
    if (hasEnteredViewport || typeof window === 'undefined') {
      return;
    }

    if (!node || !('IntersectionObserver' in window)) {
      setHasEnteredViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasEnteredViewport(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasEnteredViewport]);

  if (numericValue === null) {
    return <div ref={containerRef}>{value}</div>;
  }

  const formatter = new Intl.NumberFormat('en-US');
  const finalValue = formatter.format(numericValue);

  return (
    <div ref={containerRef}>
      <span className="relative inline-grid tabular-nums">
        <span className="invisible" aria-hidden="true">
          {finalValue}
        </span>
        <span className="absolute inset-0">{formatter.format(animatedValue)}</span>
      </span>
    </div>
  );
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
    <section
      aria-label="Key statistics"
      className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800 sm:grid-cols-3"
    >
      {stats.map(({ icon: Icon, value, label }) => (
        <div key={label} className="flex items-center gap-3">
          <Icon className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <div>
            <div className="text-xl font-bold text-gray-900 dark:text-white">
              <AnimatedStatValue value={value} />
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300">{label}</div>
          </div>
        </div>
      ))}
    </section>
  );
}
