export const DISPUTE_LEVELS = ['anchor', 'review', 'appeal'] as const;
export type DisputeLevel = (typeof DISPUTE_LEVELS)[number];

export const HOUR_MS = 3_600_000;

export const LEVEL_WINDOW_MS: Record<DisputeLevel, number> = {
  anchor: 72 * HOUR_MS, // the anchor is asked to respond (72h)
  review: 7 * 24 * HOUR_MS, // a maintainer decides (7d)
  appeal: 14 * 24 * HOUR_MS, // maintainers decide an appeal (14d) (docs/GOVERNANCE.md)
};

export const APPEAL_WINDOW_MS = 14 * 24 * HOUR_MS; // after a decision, the filer may appeal for this long

export const DISPUTE_LEVEL_LABELS: Record<DisputeLevel, string> = {
  anchor: 'Anchor response',
  review: 'Maintainer review',
  appeal: 'Appeal',
};

export function nextLevel(level: DisputeLevel): DisputeLevel | null {
  if (level === 'anchor') return 'review';
  if (level === 'review') return 'appeal';
  return null;
}

export function levelDeadline(level: DisputeLevel, enteredAt: string): string {
  const enteredTime = new Date(enteredAt).getTime();
  if (Number.isNaN(enteredTime)) {
    throw new RangeError(`Invalid date string: ${enteredAt}`);
  }
  const windowMs = LEVEL_WINDOW_MS[level];
  return new Date(enteredTime + windowMs).toISOString();
}

export function isOverdue(
  d: { status: string; levelDeadline: string },
  now: Date = new Date()
): boolean {
  if (d.status !== 'open') return false;
  const deadlineMs = new Date(d.levelDeadline).getTime();
  return now.getTime() > deadlineMs;
}

export const DISPUTE_CATEGORIES = [
  'wrong_amount',
  'not_received',
  'delayed',
  'wrong_account',
  'refund_missing',
  'other',
] as const;

export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory, string> = {
  wrong_amount: 'Wrong amount received',
  not_received: 'Funds not received',
  delayed: 'Unreasonable delay',
  wrong_account: 'Sent to wrong account',
  refund_missing: 'Refund not received',
  other: 'Other',
};
