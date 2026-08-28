import { clsx } from 'clsx';
import type { RiskLevel } from '@/types';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'mock';
  risk?: RiskLevel;
}

/**
 * Badges carry status, and status on this product means one of three things: an
 * anchor answered, an anchor failed, or nobody has looked yet. Those map onto
 * the three semantic status tokens rather than six raw Tailwind hues — a
 * six-colour badge set spends the whole colour budget on labels and leaves the
 * accent nothing to mark.
 *
 * `info` deliberately resolves to the neutral treatment. It was a blue badge,
 * which introduced a fourth hue in order to say "this is a note".
 *
 * `mock` is the one variant that must never be quiet. It marks data that is
 * illustrative rather than observed, on a product whose entire claim is the
 * difference between those two things, so it gets a ring and uppercase mono
 * instead of a soft orange fill that reads as decoration.
 *
 * Square, not pill-shaped: `rounded-full` on a status chip is decoration, and
 * this system ships hard edges.
 */
export function Badge({ children, variant, risk }: BadgeProps) {
  const resolvedVariant = risk
    ? ({ low: 'success', medium: 'warning', high: 'danger' } as const)[risk]
    : (variant ?? 'default');

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-sm px-2 py-0.5',
        'font-mono text-xs font-medium tracking-wide whitespace-nowrap',
        {
          'bg-bg-sunken text-secondary-text': resolvedVariant === 'default',
          'bg-accent-subtle text-status-up': resolvedVariant === 'success',
          'text-status-unknown ring-status-unknown/40 bg-transparent ring-1':
            resolvedVariant === 'warning',
          'text-status-down ring-status-down/40 bg-transparent ring-1':
            resolvedVariant === 'danger',
          'bg-bg-sunken text-secondary-text ring-border ring-1': resolvedVariant === 'info',
          'text-status-unknown ring-status-unknown bg-transparent uppercase ring-1':
            resolvedVariant === 'mock',
        }
      )}
    >
      {children}
    </span>
  );
}
