'use client';

import { useEffect, useState } from 'react';

interface UseCountUpOptions {
  end: number;
  start?: number;
  duration?: number;
  enabled?: boolean;
}

export function useCountUp({ end, start = 0, duration = 1200, enabled = true }: UseCountUpOptions) {
  const [value, setValue] = useState(start);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);

    return () => {
      mediaQuery.removeEventListener('change', updatePreference);
    };
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      setValue(end);
      return;
    }

    if (!enabled) {
      setValue(start);
      return;
    }

    if (duration <= 0 || start === end) {
      setValue(end);
      return;
    }

    let frameId = 0;
    const startTime = performance.now();
    const delta = end - start;

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = start + delta * eased;

      setValue(progress >= 1 ? end : Math.round(nextValue));

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    setValue(start);
    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [duration, enabled, end, prefersReducedMotion, start]);

  return prefersReducedMotion ? end : value;
}
