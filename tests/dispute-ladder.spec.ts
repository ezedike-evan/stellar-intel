import { describe, it, expect } from 'vitest';
import {
  DISPUTE_LEVELS,
  DISPUTE_LEVEL_LABELS,
  DISPUTE_CATEGORIES,
  DISPUTE_CATEGORY_LABELS,
  nextLevel,
  levelDeadline,
  isOverdue,
  type DisputeLevel,
  type DisputeCategory,
} from '@/lib/reputation/dispute-ladder';

describe('dispute-ladder', () => {
  it('chains nextLevel from anchor to review to appeal and ends in null', () => {
    expect(nextLevel('anchor')).toBe('review');
    expect(nextLevel('review')).toBe('appeal');
    expect(nextLevel('appeal')).toBeNull();
  });

  it('calculates levelDeadline correctly', () => {
    const entered = '2026-01-01T00:00:00.000Z';
    // anchor is 72h = 3 days
    expect(levelDeadline('anchor', entered)).toBe('2026-01-04T00:00:00.000Z');
    // review is 7d
    expect(levelDeadline('review', entered)).toBe('2026-01-08T00:00:00.000Z');
    // appeal is 14d
    expect(levelDeadline('appeal', entered)).toBe('2026-01-15T00:00:00.000Z');
  });

  it('throws RangeError on invalid date in levelDeadline', () => {
    expect(() => levelDeadline('anchor', 'not-a-valid-date')).toThrow(RangeError);
  });

  it('evaluates isOverdue correctly', () => {
    const deadline = '2026-01-04T00:00:00.000Z';
    const atDeadline = new Date(deadline);
    const beforeDeadline = new Date(atDeadline.getTime() - 1000);
    const afterDeadline = new Date(atDeadline.getTime() + 1);

    expect(isOverdue({ status: 'open', levelDeadline: deadline }, beforeDeadline)).toBe(false);
    expect(isOverdue({ status: 'open', levelDeadline: deadline }, atDeadline)).toBe(false);
    expect(isOverdue({ status: 'open', levelDeadline: deadline }, afterDeadline)).toBe(true);

    // Non-open status is never overdue
    expect(isOverdue({ status: 'accepted', levelDeadline: deadline }, afterDeadline)).toBe(false);
    expect(isOverdue({ status: 'rejected', levelDeadline: deadline }, afterDeadline)).toBe(false);
  });

  it('ensures every category has a non-empty label', () => {
    for (const cat of DISPUTE_CATEGORIES) {
      expect(DISPUTE_CATEGORY_LABELS[cat as DisputeCategory]).toBeDefined();
      expect(DISPUTE_CATEGORY_LABELS[cat as DisputeCategory].length).toBeGreaterThan(0);
    }
  });

  it('ensures every level has a non-empty label', () => {
    for (const lvl of DISPUTE_LEVELS) {
      expect(DISPUTE_LEVEL_LABELS[lvl as DisputeLevel]).toBeDefined();
      expect(DISPUTE_LEVEL_LABELS[lvl as DisputeLevel].length).toBeGreaterThan(0);
    }
  });
});
