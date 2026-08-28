'use client';

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';

interface TooltipProps {
  /** Tooltip body. Rendered inside a `role="tooltip"` element. */
  content: ReactNode;
  /** The trigger element. Given a tabIndex and aria-describedby automatically. */
  children: ReactNode;
  className?: string;
}

/**
 * Keyboard-accessible tooltip: opens on hover or keyboard focus, closes on
 * blur, mouse-leave, or Escape. The trigger is reachable via Tab and exposes
 * the tooltip content through `aria-describedby`, so screen readers announce
 * it alongside the trigger's own label.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <span className={clsx('relative inline-flex', className)}>
      <span
        tabIndex={0}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className="inline-flex cursor-help items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          id={tooltipId}
          className="absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-lg border border-border bg-bg-subtle p-3 text-xs leading-relaxed text-secondary-text"
        >
          {content}
        </span>
      )}
    </span>
  );
}
