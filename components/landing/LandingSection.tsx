'use client';

import React from 'react';
import { clsx } from 'clsx';
import { useInView } from '@/hooks/useInView';

interface LandingSectionProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  delay?: number;
}

export function LandingSection({ children, className, delay = 0, ...props }: LandingSectionProps) {
  const [ref, inView] = useInView({ threshold: 0.1, triggerOnce: true });

  return (
    <section
      ref={ref}
      className={clsx(
        'transition-all duration-700 ease-out',
        inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8',
        'motion-reduce:transition-none motion-reduce:transform-none motion-reduce:opacity-100',
        className
      )}
      style={{
        transitionDelay: inView && delay ? `${delay}ms` : '0ms',
      }}
      {...props}
    >
      {children}
    </section>
  );
}
