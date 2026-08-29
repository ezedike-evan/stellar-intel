import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  rows?: number;
  columns?: number;
  variant?: 'block' | 'table';
  cellClassName?: string;
}

/**
 * Loading placeholders read from the surface tokens rather than raw greys, so
 * they sit on the page instead of hovering slightly off it — `bg-bg-sunken` on a
 * warm off-white is visibly the wrong grey, and `bg-bg-sunken` is far too light
 * against the dark surface.
 *
 * A skeleton should also match the shape of what loads. These are thin bars at
 * text height rather than large blocks, because what arrives is rows of
 * numbers.
 */
export function Skeleton({
  rows,
  columns = 5,
  variant,
  className,
  cellClassName,
  ...props
}: SkeletonProps) {
  const resolvedVariant = variant ?? (rows ? 'table' : 'block');

  if (resolvedVariant === 'table') {
    const rowCount = rows ?? 5;

    return (
      <table className="w-full text-sm">
        <tbody>
          {Array.from({ length: rowCount }).map((_, i) => (
            <tr key={i} className="border-border border-t">
              {Array.from({ length: columns }).map((__, j) => (
                <td key={j} className="px-4 py-3">
                  <div
                    className={clsx('bg-bg-sunken h-3 animate-pulse rounded-sm', cellClassName)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={clsx('bg-bg-sunken animate-pulse rounded-sm', className)}
      {...props}
    />
  );
}
