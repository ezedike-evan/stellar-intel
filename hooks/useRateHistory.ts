'use client';

import { useEffect, useRef, useState } from 'react';
import type { RateComparison } from '@/types';

/** Points kept per anchor. The issue asks for at least five. */
export const RATE_HISTORY_LENGTH = 8;

export type RateHistory = Record<string, number[]>;

/**
 * Rolling in-memory history of each anchor's exchange rate, appended once per
 * SWR revalidation (#792).
 *
 * Client-side only and deliberately not persisted: this is a "what has it done
 * in the last few minutes" affordance, and a rate from a previous session would
 * be presented as if it were recent.
 *
 * Keyed by `corridorId:anchorId` rather than `anchorId`, so switching corridors
 * cannot feed NGN rates into the ZAR sparkline. Entries for other corridors are
 * dropped on switch rather than kept, because an anchor's rate history is only
 * meaningful within one corridor and holding them would grow without bound.
 */
export function useRateHistory(
  rates: RateComparison | undefined,
  maxPoints: number = RATE_HISTORY_LENGTH
): RateHistory {
  const [history, setHistory] = useState<RateHistory>({});

  // The append is keyed off the identity of the `rates` object, which SWR
  // replaces once per successful revalidation. Appending in render, or on every
  // render, would add a point each time the parent re-rendered for an unrelated
  // reason and turn the sparkline into a picture of React's scheduling.
  const lastSeen = useRef<RateComparison | undefined>(undefined);

  useEffect(() => {
    if (!rates || rates === lastSeen.current) return;
    lastSeen.current = rates;

    const corridorId = rates.corridorId;

    setHistory((prev) => {
      const next: RateHistory = {};
      let changed = false;

      for (const rate of rates.rates) {
        // A null or non-positive rate is an absent observation, not a zero. It
        // must not be plotted as a value.
        if (rate.exchangeRate === null || rate.exchangeRate <= 0) continue;

        const key = `${corridorId}:${rate.anchorId}`;
        const series = prev[key] ?? [];
        next[key] = [...series, rate.exchangeRate].slice(-maxPoints);
        changed = true;
      }

      // Keys absent from `next` are for other corridors or anchors that stopped
      // quoting; both are dropped. Returning `prev` unchanged when nothing was
      // recorded keeps the identity stable so consumers do not re-render.
      if (!changed && Object.keys(prev).length === 0) return prev;
      return next;
    });
  }, [rates, maxPoints]);

  return history;
}

/**
 * Accessible description of a series, for the text alternative beside the
 * `aria-hidden` chart. Returns null when there is nothing to describe, so the
 * caller renders no empty announcement.
 */
export function describeRateTrend(series: number[] | undefined): string | null {
  if (!series || series.length < 2) return null;

  const first = series[0]!;
  const last = series[series.length - 1]!;
  const refreshes = series.length;

  if (first === last) {
    return `Rate unchanged over the last ${refreshes} refreshes`;
  }

  const direction = last > first ? 'up' : 'down';
  const pct = Math.abs(((last - first) / first) * 100);

  // Below a tenth of a percent, "up 0.0%" reads as a bug. Say the direction and
  // stop rather than printing a number that rounds to nothing.
  if (pct < 0.05) {
    return `Rate trending ${direction} slightly over the last ${refreshes} refreshes`;
  }

  return `Rate trending ${direction} ${pct.toFixed(1)}% over the last ${refreshes} refreshes`;
}
