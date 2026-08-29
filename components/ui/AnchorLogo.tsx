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

  // These are the anchors' own brand marks, so the colour belongs to them — but
  // seven saturated logos in a column will out-shout a single accent and turn a
  // record into a directory listing. They sit slightly desaturated by default
  // and come to full colour on hover or focus within the row, which keeps
  // recognition without spending the page's colour budget on avatars.
  //
  // `rounded-full` is deliberate here and is the only place it is used: a logo
  // mark is genuinely circular, unlike the status chips that used to be pills.
  const baseClassName = clsx(
    'border-border bg-bg-sunken text-secondary-text inline-flex shrink-0 items-center justify-center',
    'overflow-hidden rounded-full border font-medium',
    'saturate-[0.75] transition-[filter] duration-100 ease-out group-hover:saturate-100 group-focus-visible:saturate-100',
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
