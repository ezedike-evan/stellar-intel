'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';

interface FreshnessPillProps {
  issuedAt: Date;
}

type Freshness = 'fresh' | 'stale' | 'expired';

function getFreshness(ageSeconds: number): Freshness {
  if (ageSeconds < 15) return 'fresh';
  if (ageSeconds < 60) return 'stale';
  return 'expired';
}

function getAgeSeconds(issuedAt: Date): number {
  return Math.floor((Date.now() - issuedAt.getTime()) / 1000);
}

export function FreshnessPill({ issuedAt }: FreshnessPillProps) {
  const [ageSeconds, setAgeSeconds] = useState(() => getAgeSeconds(issuedAt));

  useEffect(() => {
    const id = setInterval(() => {
      setAgeSeconds(getAgeSeconds(issuedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [issuedAt]);

  const freshness = getFreshness(ageSeconds);

  const label =
    freshness === 'fresh'
      ? `${ageSeconds}s`
      : freshness === 'stale'
        ? `${ageSeconds}s`
        : `${ageSeconds}s`;

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums transition-colors',
        {
          'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400':
            freshness === 'fresh',
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400':
            freshness === 'stale',
          'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400': freshness === 'expired',
        }
      )}
    >
      {label}
    </span>
  );
}
