import { useEffect, useRef, useState } from 'react';

interface UseInViewOptions {
  threshold?: number | number[];
  rootMargin?: string;
  triggerOnce?: boolean;
}

export function useInView(options: UseInViewOptions = {}) {
  const { threshold = 0.1, rootMargin = '0px', triggerOnce = true } = options;
  const [inView, setInView] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const ref = useRef<HTMLElement | null>(null);

  const thresholdString = typeof threshold === 'object' ? JSON.stringify(threshold) : threshold;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }

    const observerThreshold =
      typeof thresholdString === 'string' ? JSON.parse(thresholdString) : thresholdString;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          setInView(true);
          if (triggerOnce) {
            observer.unobserve(element);
          }
        } else if (!triggerOnce) {
          setInView(false);
        }
      },
      {
        threshold: observerThreshold,
        rootMargin,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [thresholdString, rootMargin, triggerOnce]);

  return [ref, inView] as const;
}
