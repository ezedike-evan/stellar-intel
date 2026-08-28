import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
}

/**
 * A card is a 1px border and a surface step, never a shadow. Shadow on every
 * card is the clearest tell of a template, and it stops meaning anything the
 * moment everything has one — depth here comes from layering surfaces
 * (background -> bg-subtle -> bg-sunken) instead.
 *
 * Selection is a border colour, not a 2px ring. A ring on every selected row of
 * a comparison table reads as noise.
 */
export function Card({ selected, className, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        'bg-bg-subtle rounded-sm border p-4',
        'transition-colors duration-100 ease-out',
        selected ? 'border-accent' : 'border-border',
        className
      )}
      {...props}
    />
  );
}
