import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * There is one accent in this interface and it marks the single most important
 * thing in a view. A `primary` button is therefore not automatically the accent
 * — it earns the accent only when the action is the point of the screen. Most
 * buttons on a monitoring surface should be `secondary`: a bordered control
 * that recedes and lets the data carry the colour.
 *
 * Sizes: `md` and `lg` clear the 44px touch-target minimum. `sm` is 36px and
 * exists for controls inside dense data rows, where a 44px target would push
 * the row height past what a comparison table can carry; it still clears
 * WCAG 2.2 AA's 24px floor. Do not use `sm` for a primary action.
 */
export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-sm font-medium',
        'transition-colors duration-100 ease-out',
        'focus-visible:ring-accent focus-visible:ring-offset-background',
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        {
          'bg-accent text-background hover:opacity-90': variant === 'primary',
          'border-control-border text-primary-text hover:bg-bg-subtle border bg-transparent':
            variant === 'secondary',
          'text-secondary-text hover:text-primary-text hover:bg-bg-subtle': variant === 'ghost',
          'bg-status-down text-background hover:opacity-90': variant === 'danger',
        },
        {
          'h-9 px-3 text-sm': size === 'sm',
          'h-11 px-4 text-sm': size === 'md',
          'h-12 px-6 text-base': size === 'lg',
        },
        className
      )}
      {...props}
    />
  );
}
