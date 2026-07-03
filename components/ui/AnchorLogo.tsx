'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { clsx } from 'clsx';

type AnchorLogoSize = 'sm' | 'md' | 'lg';

interface AnchorLogoProps {
  anchorId: string;
  anchorName: string;
  size?: AnchorLogoSize;
  className?: string;
}

const sizeClasses: Record<AnchorLogoSize, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
};

function fallbackLetter(anchorName: string, anchorId: string) {
  const source = anchorName.trim() || anchorId.trim();
  return source.match(/[A-Za-z0-9]/)?.[0]?.toUpperCase() ?? '?';
}

export function AnchorLogo({ anchorId, anchorName, size = 'md', className }: AnchorLogoProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoSrc = `/anchors/${encodeURIComponent(anchorId)}.svg`;
  const initial = useMemo(() => fallbackLetter(anchorName, anchorId), [anchorId, anchorName]);

  useEffect(() => {
    setLogoFailed(false);
  }, [anchorId]);

  const baseClassName = clsx(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-100 font-semibold text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200',
    sizeClasses[size],
    className
  );

  if (logoFailed) {
    return (
      <span className={baseClassName} role="img" aria-label={`${anchorName} logo fallback`}>
        {initial}
      </span>
    );
  }

  return (
    <span className={baseClassName}>
      <Image
        src={logoSrc}
        alt={`${anchorName} logo`}
        width={40}
        height={40}
        unoptimized
        className="h-full w-full object-contain"
        onError={() => setLogoFailed(true)}
      />
    </span>
  );
}
