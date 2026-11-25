import { describe, it, expect } from 'vitest';
import { ANCHORS } from '@/constants/anchors';
import {
  ANCHOR_SLA_THRESHOLDS,
  DEFAULT_SLA_THRESHOLDS,
  getSlaThresholds,
} from '@/constants/sla-thresholds';
import { DEFAULT_SLA_UNDERWRITING } from '@/lib/reputation/sla';

describe('SLA Thresholds config (#2143)', () => {
  it('every key of ANCHOR_SLA_THRESHOLDS is an id in ANCHORS', () => {
    const validAnchorIds = new Set(ANCHORS.map((a) => a.id));
    for (const key of Object.keys(ANCHOR_SLA_THRESHOLDS)) {
      expect(validAnchorIds.has(key)).toBe(true);
    }
  });

  it('every declared value in ANCHOR_SLA_THRESHOLDS is a positive finite number', () => {
    for (const [key, thresholds] of Object.entries(ANCHOR_SLA_THRESHOLDS)) {
      if (thresholds.p95Ms !== undefined) {
        expect(Number.isFinite(thresholds.p95Ms)).toBe(true);
        expect(thresholds.p95Ms).toBeGreaterThan(0);
      }
      if (thresholds.p99Ms !== undefined) {
        expect(Number.isFinite(thresholds.p99Ms)).toBe(true);
        expect(thresholds.p99Ms).toBeGreaterThan(0);
      }
    }
  });

  it('for every anchor in ANCHORS, getSlaThresholds(id).p99Ms >= getSlaThresholds(id).p95Ms', () => {
    for (const anchor of ANCHORS) {
      const thresholds = getSlaThresholds(anchor.id);
      expect(thresholds.p99Ms).toBeGreaterThanOrEqual(thresholds.p95Ms);
    }
  });

  it('DEFAULT_SLA_THRESHOLDS.p95Ms matches DEFAULT_SLA_UNDERWRITING.maxP95SettlementMs', () => {
    expect(DEFAULT_SLA_THRESHOLDS.p95Ms).toBe(DEFAULT_SLA_UNDERWRITING.maxP95SettlementMs);
  });

  it('an unknown anchor id receives the default thresholds', () => {
    const thresholds = getSlaThresholds('non-existent-anchor');
    expect(thresholds).toEqual(DEFAULT_SLA_THRESHOLDS);
  });
});
