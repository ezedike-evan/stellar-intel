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
        className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
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
          className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
          role="status"
          aria-label="Firm quote expired"
        >
          Unavailable
        </span>
      );
    }

    return (
      <span
        className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300"
        role="timer"
        aria-live="polite"
        aria-label={`Firm quote expires in ${timeLeft} seconds`}
      >
        Firm &middot; {timeLeft}s left
      </span>
    );
  }

  // default to indicative
  return (
    <span
      className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
      role="status"
      aria-label="Indicative quote"
    >
      Indicative
    </span>
  );
}
