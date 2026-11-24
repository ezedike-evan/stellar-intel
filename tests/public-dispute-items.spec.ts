import { describe, expect, it } from 'vitest';
import { publicDisputeRef } from '@/lib/reputation/adjudication-log';
import { DISPUTE_CATEGORY_LABELS } from '@/lib/reputation/dispute-ladder';
import { type Dispute, toPublicDisputeItems } from '@/lib/reputation/disputes';

const FILER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'disp-1',
    intentHash: 'a'.repeat(64),
    publicKey: FILER,
    anchorId: 'moneygram',
    reason: 'test reason',
    status: 'open',
    createdAt: '2026-10-01T10:00:00.000Z',
    resolvedAt: null,
    category: 'delayed',
    level: 'anchor',
    levelDeadline: '2026-10-04T10:00:00.000Z',
    subjectKind: 'outcome',
    subjectRef: 'a'.repeat(64),
    appealedAt: null,
    ...overrides,
  };
}

describe('toPublicDisputeItems (DSP010)', () => {
  it("keeps only the given anchor's disputes", () => {
    const items = toPublicDisputeItems(
      [
        makeDispute({ id: 'mine-1' }),
        makeDispute({ id: 'theirs', anchorId: 'cowrie' }),
        makeDispute({ id: 'mine-2' }),
      ],
      'moneygram'
    );
    expect(items.map((i) => i.id)).toEqual([
      publicDisputeRef('mine-1'),
      publicDisputeRef('mine-2'),
    ]);
  });

  it('lists newest first', () => {
    const items = toPublicDisputeItems(
      [
        makeDispute({ id: 'old', createdAt: '2026-09-01T00:00:00.000Z' }),
        makeDispute({ id: 'new', createdAt: '2026-11-01T00:00:00.000Z' }),
        makeDispute({ id: 'mid', createdAt: '2026-10-01T00:00:00.000Z' }),
      ],
      'moneygram'
    );
    expect(items.map((i) => i.createdAt)).toEqual([
      '2026-11-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    ]);
  });

  it('caps the list at 10 by default, and at the given limit', () => {
    const many = Array.from({ length: 15 }, (_, n) =>
      makeDispute({ id: `d-${n}`, createdAt: new Date(Date.UTC(2026, 9, n + 1)).toISOString() })
    );
    expect(toPublicDisputeItems(many, 'moneygram')).toHaveLength(10);
    expect(toPublicDisputeItems(many, 'moneygram', 3)).toHaveLength(3);
  });

  it("shows the category label, never the filer's free-text reason", () => {
    const [item] = toPublicDisputeItems(
      [makeDispute({ category: 'not_received', reason: 'my landlord is called Ada, call me' })],
      'moneygram'
    );
    expect(item!.reason).toBe(DISPUTE_CATEGORY_LABELS.not_received);
    expect(JSON.stringify(item)).not.toContain('landlord');
  });

  it('never exposes the filer publicKey or the internal dispute id', () => {
    const [item] = toPublicDisputeItems([makeDispute({ id: 'internal-uuid-1' })], 'moneygram');
    expect(Object.keys(item!).sort()).toEqual(['createdAt', 'id', 'reason', 'status']);
    expect(JSON.stringify(item)).not.toContain(FILER);
    expect(item!.id).not.toBe('internal-uuid-1');
  });

  it('uses the 16-hex-character public dispute reference as the id', () => {
    const [item] = toPublicDisputeItems([makeDispute({ id: 'disp-42' })], 'moneygram');
    expect(item!.id).toMatch(/^[0-9a-f]{16}$/);
    expect(item!.id).toBe(publicDisputeRef('disp-42'));
  });

  it('shows open disputes as open and accepted or rejected ones as resolved', () => {
    const items = toPublicDisputeItems(
      [
        makeDispute({ id: 'a', status: 'open', createdAt: '2026-10-03T00:00:00.000Z' }),
        makeDispute({ id: 'b', status: 'accepted', createdAt: '2026-10-02T00:00:00.000Z' }),
        makeDispute({ id: 'c', status: 'rejected', createdAt: '2026-10-01T00:00:00.000Z' }),
      ],
      'moneygram'
    );
    expect(items.map((i) => i.status)).toEqual(['open', 'resolved', 'resolved']);
  });
});
