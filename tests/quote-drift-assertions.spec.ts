import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDrifted, DRIFT_THRESHOLD_PERCENT } from '@/lib/reputation/thresholds';
import {
  detectQuoteDrift,
  probeQuoteDrift,
  InMemoryDriftStore,
  type AnchorQuote,
  type RateProbeResult,
} from '@/lib/reputation/probe';
import type { Anchor } from '@/types';
import { BOUNDARY_QUOTES, REFERENCE_MEDIAN_RATE } from './fixtures/quote-drift';

describe('quote-drift threshold and boundary assertions (#1087)', () => {
  describe('isDrifted boundary behavior', () => {
    it('does not flag quotes with deviations strictly within the default 3% threshold', () => {
      // 0% deviation
      expect(isDrifted(0)).toBe(false);
      // Positive deviations within 3%
      expect(isDrifted(1.5)).toBe(false);
      expect(isDrifted(2.99)).toBe(false);
      // Exact threshold boundary is not considered drifted (|deviation| > threshold)
      expect(isDrifted(3.0)).toBe(false);

      // Negative deviations within 3%
      expect(isDrifted(-1.5)).toBe(false);
      expect(isDrifted(-2.99)).toBe(false);
      expect(isDrifted(-3.0)).toBe(false);
    });

    it('flags quotes with deviations just outside the default 3% threshold', () => {
      // Positive deviation just over 3%
      expect(isDrifted(3.01)).toBe(true);
      expect(isDrifted(3.5)).toBe(true);
      expect(isDrifted(10.0)).toBe(true);

      // Negative deviation just over 3%
      expect(isDrifted(-3.01)).toBe(true);
      expect(isDrifted(-3.5)).toBe(true);
      expect(isDrifted(-15.0)).toBe(true);
    });

    it('asserts that changing the threshold parameter changes which cases pass (acceptance criteria)', () => {
      const deviation = 4.0; // 4% deviation

      // At default threshold (3%), 4% is drifted
      expect(isDrifted(deviation, 3.0)).toBe(true);

      // Relaxing threshold to 5% makes 4% pass (not drifted)
      expect(isDrifted(deviation, 5.0)).toBe(false);

      // Tightening threshold to 2% keeps it flagged
      expect(isDrifted(deviation, 2.0)).toBe(true);

      // Tightening to 1% flags smaller deviations that previously passed
      expect(isDrifted(1.5, 3.0)).toBe(false);
      expect(isDrifted(1.5, 1.0)).toBe(true);
    });
  });

  describe('detectQuoteDrift with fixture data', () => {
    it('evaluates all boundary fixture cases accurately against median', () => {
      // Build quote list where median is strictly 1000
      const quotes: AnchorQuote[] = [
        { anchorId: 'anchor-base-1', rate: REFERENCE_MEDIAN_RATE },
        { anchorId: 'anchor-base-2', rate: REFERENCE_MEDIAN_RATE },
        ...BOUNDARY_QUOTES.map((bq, idx) => ({
          anchorId: `anchor-${idx}-${bq.name}`,
          rate: bq.rate,
        })),
      ];

      const samples = detectQuoteDrift(quotes, 'usdc-ngn', 3.0);

      for (const bq of BOUNDARY_QUOTES) {
        const sample = samples.find((s) => s.anchorId.includes(bq.name));
        expect(sample).toBeDefined();
        if (!sample) continue;

        expect(sample.deviationPercent).toBeCloseTo(bq.deviationPercent, 2);

        // Assert flagged status strictly based on > 3.0% threshold
        const expectedFlagged = Math.abs(bq.deviationPercent) > 3.0;
        expect(sample.flagged).toBe(expectedFlagged);
      }
    });

    it('adapts when custom threshold is passed to detectQuoteDrift', () => {
      const quotes: AnchorQuote[] = [
        { anchorId: 'base-1', rate: 1000 },
        { anchorId: 'base-2', rate: 1000 },
        { anchorId: 'base-3', rate: 1000 },
        { anchorId: 'outlier-4pct', rate: 1040 }, // 4% above median (1000)
        { anchorId: 'outlier-2pct', rate: 1020 }, // 2% above median (1000)
      ];

      // With 5% threshold: neither is flagged
      const samples5 = detectQuoteDrift(quotes, 'usdc-ngn', 5.0);
      expect(samples5.find((s) => s.anchorId === 'outlier-4pct')!.flagged).toBe(false);
      expect(samples5.find((s) => s.anchorId === 'outlier-2pct')!.flagged).toBe(false);

      // With 3% threshold: only 4% is flagged
      const samples3 = detectQuoteDrift(quotes, 'usdc-ngn', 3.0);
      expect(samples3.find((s) => s.anchorId === 'outlier-4pct')!.flagged).toBe(true);
      expect(samples3.find((s) => s.anchorId === 'outlier-2pct')!.flagged).toBe(false);

      // With 1% threshold: both are flagged
      const samples1 = detectQuoteDrift(quotes, 'usdc-ngn', 1.0);
      expect(samples1.find((s) => s.anchorId === 'outlier-4pct')!.flagged).toBe(true);
      expect(samples1.find((s) => s.anchorId === 'outlier-2pct')!.flagged).toBe(true);
    });
  });

  describe('probeQuoteDrift execution and recording', () => {
    it('records flagged drift samples and skips unreachable anchors cleanly', async () => {
      const store = new InMemoryDriftStore();
      const mockAnchors: Anchor[] = [
        {
          id: 'anchor-normal-1',
          name: 'Normal 1',
          homeDomain: 'normal1.com',
          assetCode: 'USDC',
          assetIssuer: 'GISSUER1',
        } as unknown as Anchor,
        {
          id: 'anchor-normal-2',
          name: 'Normal 2',
          homeDomain: 'normal2.com',
          assetCode: 'USDC',
          assetIssuer: 'GISSUER2',
        } as unknown as Anchor,
        {
          id: 'anchor-drifted',
          name: 'Drifted Anchor',
          homeDomain: 'drifted.com',
          assetCode: 'USDC',
          assetIssuer: 'GISSUER3',
        } as unknown as Anchor,
        {
          id: 'anchor-unreachable',
          name: 'Unreachable Anchor',
          homeDomain: 'unreachable.com',
          assetCode: 'USDC',
          assetIssuer: 'GISSUER4',
        } as unknown as Anchor,
      ];

      const rates: Record<string, RateProbeResult> = {
        'anchor-normal-1': { ok: true, rate: 1000 },
        'anchor-normal-2': { ok: true, rate: 1000 },
        'anchor-drifted': { ok: true, rate: 1100 }, // 10% above median
        'anchor-unreachable': { ok: false, error: 'Connection timeout' },
      };

      const fetchRate = async (anchor: Anchor): Promise<RateProbeResult> => rates[anchor.id]!;
      const fixedTime = 1700000000000;

      const samples = await probeQuoteDrift(
        mockAnchors,
        'usdc-ngn',
        '100',
        store,
        { fetchRate, now: () => fixedTime },
        3.0
      );

      // Only 3 reachable anchors are sampled
      expect(samples).toHaveLength(3);
      expect(samples.find((s) => s.anchorId === 'anchor-unreachable')).toBeUndefined();

      const driftedSample = samples.find((s) => s.anchorId === 'anchor-drifted')!;
      expect(driftedSample.flagged).toBe(true);
      expect(driftedSample.medianRate).toBe(1000);
      expect(driftedSample.deviationPercent).toBeCloseTo(10.0, 2);
      expect(driftedSample.at).toBe(fixedTime);

      // Check stored records in sink
      const stored = store.samples('anchor-drifted');
      expect(stored).toHaveLength(1);
      expect(stored[0]!.flagged).toBe(true);
    });
  });
});
