'use client';

import { useEffect, useState } from 'react';

export interface UseCountdownResult {
  /** Whole seconds remaining until durationMs elapses since the last resetKey change. */
  secondsRemaining: number;
  /** Whole seconds elapsed since the last resetKey change — used for the reduced-motion fallback. */
  elapsedSeconds: number;
  prefersReducedMotion: boolean;
  /** Progress through the countdown as a value from 0 (just reset) to 1 (expired). */
  progress: number;
  /** Total duration in whole seconds (ceil of durationMs / 1000). */
  totalSeconds: number;
}

interface CountdownState {
  startTime: number;
  now: number;
}

/**
 * Counts down from durationMs to 0, restarting whenever resetKey changes
 * (by reference/value equality). Ticks once per second.
 *
 * startTime and now are kept in a single state object rather than two
 * separate primitives: if a tick's Date.now() happens to equal the value
 * already in state (plausible under fake timers, or just unlucky timing),
 * React bails out of re-rendering a primitive setState with an unchanged
 * value — silently freezing the countdown. A fresh object every update
 * sidesteps that.
 */
export function useCountdown(durationMs: number, resetKey: unknown): UseCountdownResult {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [{ startTime, now }, setState] = useState<CountdownState>(() => ({
    startTime: Date.now(),
    now: Date.now(),
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    const t = Date.now();
    setState({ startTime: t, now: t });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      setState((s) => ({ ...s, now: Date.now() }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedMs = now - startTime;
  const clampedMs = Math.min(elapsedMs, durationMs);

  return {
    secondsRemaining: Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000)),
    elapsedSeconds: Math.max(0, Math.floor(elapsedMs / 1000)),
    prefersReducedMotion,
    progress: durationMs > 0 ? clampedMs / durationMs : 0,
    totalSeconds: Math.ceil(durationMs / 1000),
  };
}
