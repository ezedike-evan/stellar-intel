'use client';

import { useState, useEffect } from 'react';
import type { AnchorRate } from '@/types';

export interface QuotePillProps {
  source: AnchorRate['source'];
  expiresAt?: Date | undefined;
  onExpire?: () => void;
}

export function QuotePill({ source, expiresAt, onExpire }: QuotePillProps) {
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (source !== 'sep38' || !expiresAt) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [source, expiresAt, onExpire]);

  if (source === 'unavailable') {
    return (
      <span
        className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs font-medium text-status-down"
        role="status"
        aria-label="Quote unavailable"
      >
        Unavailable
      </span>
    );
  }

  if (source === 'sep38') {
    if (timeLeft === 0) {
      return (
        <span
          className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs font-medium text-status-down"
          role="status"
          aria-label="Firm quote expired"
        >
          Unavailable
        </span>
      );
    }

    return (
      <span
        className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-status-up"
        role="timer"
        aria-live="polite"
        aria-label={`Firm quote expires in ${timeLeft} seconds`}
      >
        Firm &middot; {timeLeft}s left
      </span>
    );
  }

  if (source === 'sep24-fee') {
    return (
      <span
        className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs font-medium text-secondary-text"
        role="status"
        aria-label="Indicative quote"
      >
        Indicative
      </span>
    );
  }

  if (source === 'sep6-info') {
    return (
      <span
        className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs font-medium text-status-unknown"
        role="status"
        aria-label="SEP-6 indicative rate"
      >
        Indicative (SEP-6)
      </span>
    );
  }

  if (source === 'sep6-fee') {
    return (
      <span
        className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent dark:bg-accent-subtle dark:text-accent"
        role="status"
        aria-label="SEP-6 indicative rate"
      >
        Indicative (SEP-6)
      </span>
    );
  }

  const _exhaustive: never = source;
  return null;
}
