import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDisputeStore, type Dispute } from '@/lib/reputation/disputes';
import {
  InMemoryAdjudicationLog,
  publicDisputeRef,
  verifyChain,
} from '@/lib/reputation/adjudication-log';
import { HOUR_MS, LEVEL_WINDOW_MS, levelDeadline } from '@/lib/reputation/dispute-ladder';
import { escalateOverdueDisputes } from '@/lib/reputation/dispute-sweep';

const NOW = new Date('2026-11-20T12:00:00.000Z');

function filedAt(ageMs: number): string {
  return new Date(NOW.getTime() - ageMs).toISOString();
}

function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
  const createdAt = overrides.createdAt ?? filedAt(72 * HOUR_MS + 1);
  const level = overrides.level ?? 'anchor';
  return {
    id: 'disp-sweep-0001',
    intentHash: 'a'.repeat(64),
    publicKey: 'G'.padEnd(56, 'A'),
    anchorId: 'moneygram',
    reason: 'funds never arrived',
    status: 'open',
    createdAt,
    resolvedAt: null,
    category: 'not_received',
    level,
    levelDeadline: levelDeadline(level, createdAt),
    subjectKind: 'outcome',
    subjectRef: 'a'.repeat(64),
    appealedAt: null,
    ...overrides,
  };
}

describe('escalateOverdueDisputes (#2138)', () => {
  let disputes: InMemoryDisputeStore;
  let log: InMemoryAdjudicationLog;

  beforeEach(() => {
    disputes = new InMemoryDisputeStore();
    log = new InMemoryAdjudicationLog();
  });

  it('escalates an anchor-level dispute that is 72h + 1ms old and logs it once', async () => {
    const dispute = makeDispute();
    await disputes.create(dispute);

    const result = await escalateOverdueDisputes({ disputes, log, now: NOW });

    expect(result).toEqual({ scanned: 1, escalated: 1 });
    const updated = await disputes.get(dispute.id);
    expect(updated?.level).toBe('review');
    expect(updated?.status).toBe('open');
    expect(updated?.levelDeadline).toBe(
      new Date(NOW.getTime() + LEVEL_WINDOW_MS.review).toISOString()
    );

    const entries = await log.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'escalated',
      level: 'review',
      rationale: 'Anchor did not respond within 72 hours.',
      disputeRef: publicDisputeRef(dispute.id),
      anchorId: 'moneygram',
      category: 'not_received',
      decidedAt: NOW.toISOString(),
    });
  });

  it('leaves a dispute alone at exactly 72h', async () => {
    const dispute = makeDispute({ createdAt: filedAt(72 * HOUR_MS) });
    await disputes.create(dispute);

    const result = await escalateOverdueDisputes({ disputes, log, now: NOW });

    expect(result).toEqual({ scanned: 1, escalated: 0 });
    expect((await disputes.get(dispute.id))?.level).toBe('anchor');
    expect(await log.list()).toHaveLength(0);
  });

  it('does not change an overdue dispute at the review rung', async () => {
    const dispute = makeDispute({ level: 'review', createdAt: filedAt(30 * 24 * HOUR_MS) });
    await disputes.create(dispute);

    const result = await escalateOverdueDisputes({ disputes, log, now: NOW });

    expect(result).toEqual({ scanned: 1, escalated: 0 });
    const unchanged = await disputes.get(dispute.id);
    expect(unchanged?.level).toBe('review');
    expect(unchanged?.levelDeadline).toBe(dispute.levelDeadline);
    expect(await log.list()).toHaveLength(0);
  });

  it('does not change an overdue dispute at the appeal rung', async () => {
    const dispute = makeDispute({ level: 'appeal', createdAt: filedAt(30 * 24 * HOUR_MS) });
    await disputes.create(dispute);

    const result = await escalateOverdueDisputes({ disputes, log, now: NOW });

    expect(result).toEqual({ scanned: 1, escalated: 0 });
    expect((await disputes.get(dispute.id))?.level).toBe('appeal');
    expect(await log.list()).toHaveLength(0);
  });

  it('ignores resolved disputes', async () => {
    const dispute = makeDispute({
      status: 'rejected',
      resolvedAt: filedAt(HOUR_MS),
    });
    await disputes.create(dispute);

    const result = await escalateOverdueDisputes({ disputes, log, now: NOW });

    expect(result).toEqual({ scanned: 0, escalated: 0 });
    expect((await disputes.get(dispute.id))?.level).toBe('anchor');
    expect(await log.list()).toHaveLength(0);
  });

  it('is idempotent across runs', async () => {
    await disputes.create(makeDispute());

    const first = await escalateOverdueDisputes({ disputes, log, now: NOW });
    const second = await escalateOverdueDisputes({ disputes, log, now: NOW });

    expect(first.escalated).toBe(1);
    expect(second).toEqual({ scanned: 1, escalated: 0 });
    expect(await log.list()).toHaveLength(1);
  });

  it('escalates every overdue anchor dispute and keeps the log chain valid', async () => {
    await disputes.create(makeDispute({ id: 'disp-sweep-0001' }));
    await disputes.create(makeDispute({ id: 'disp-sweep-0002', anchorId: 'cowrie' }));
    await disputes.create(makeDispute({ id: 'disp-sweep-0003', createdAt: filedAt(HOUR_MS) }));

    const result = await escalateOverdueDisputes({ disputes, log, now: NOW });

    expect(result).toEqual({ scanned: 3, escalated: 2 });
    const entries = await log.list();
    expect(entries).toHaveLength(2);
    expect(verifyChain(entries)).toMatchObject({ ok: true, length: 2 });
  });
});
