import type { AnchorQuote } from '@/lib/reputation/probe';

/** Reference median rate used in boundary tests. */
export const REFERENCE_MEDIAN_RATE = 1000;

/**
 * Fixture quotes with known exact percentage deviations from REFERENCE_MEDIAN_RATE (1000).
 */
export const BOUNDARY_QUOTES: Array<{
  name: string;
  deviationPercent: number;
  rate: number;
}> = [
  { name: 'exact-median', deviationPercent: 0, rate: 1000 },
  { name: 'just-inside-upper', deviationPercent: 2.99, rate: 1029.9 },
  { name: 'exact-threshold-upper', deviationPercent: 3.0, rate: 1030 },
  { name: 'just-outside-upper', deviationPercent: 3.01, rate: 1030.1 },
  { name: 'just-inside-lower', deviationPercent: -2.99, rate: 970.1 },
  { name: 'exact-threshold-lower', deviationPercent: -3.0, rate: 970 },
  { name: 'just-outside-lower', deviationPercent: -3.01, rate: 969.9 },
  { name: 'far-outside-upper', deviationPercent: 10.0, rate: 1100 },
  { name: 'far-outside-lower', deviationPercent: -15.0, rate: 850 },
];

/**
 * Helper to build an array of AnchorQuote objects with stable median rate.
 */
export function buildBoundaryAnchorQuotes(
  testQuotes: Array<{ id: string; rate: number }>
): AnchorQuote[] {
  return [
    { anchorId: 'baseline-1', rate: REFERENCE_MEDIAN_RATE },
    { anchorId: 'baseline-2', rate: REFERENCE_MEDIAN_RATE },
    ...testQuotes.map((q) => ({ anchorId: q.id, rate: q.rate })),
  ];
}
