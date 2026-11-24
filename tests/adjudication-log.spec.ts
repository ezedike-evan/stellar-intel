// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The Postgres store is driven through a fake executor, as in tests/dispute-store.spec.ts.
const executor = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/reputation/pool', () => ({
  getSqlExecutor: () => executor,
  hasDatabaseUrl: () => true,
}));

import {
  InMemoryAdjudicationLog,
  PostgresAdjudicationLog,
  computeEntryHash,
  verifyChain,
  summarizeLog,
  publicDisputeRef,
  assertPublicSafe,
  PublicTextError,
  AdjudicationLogConflictError,
  GENESIS_HASH,
  type AdjudicationAction,
  type AdjudicationEntry,
  type AdjudicationEntryInput,
  _resetAdjudicationSchema,
} from '@/lib/reputation/adjudication-log';

/** A real public ref, as the routes pass: publicDisputeRef(dispute.id). */
const DREF = publicDisputeRef('dispute-1');

describe('adjudication-log', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('InMemoryAdjudicationLog', () => {
    it('appends entries sequentially with linked hashes and verifies chain', async () => {
      const log = new InMemoryAdjudicationLog();
      const e1 = await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: 'Filing dispute',
        decidedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(e1.seq).toBe(1);
      expect(e1.prevHash).toBe(GENESIS_HASH);

      const e2 = await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'escalated',
        rationale: 'Escalating to review',
        decidedAt: '2026-01-04T00:00:00.000Z',
      });
      expect(e2.seq).toBe(2);
      expect(e2.prevHash).toBe(e1.entryHash);

      const e3 = await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'accepted',
        rationale: 'Dispute accepted',
        decidedAt: '2026-01-05T00:00:00.000Z',
      });
      expect(e3.seq).toBe(3);
      expect(e3.prevHash).toBe(e2.entryHash);

      const list = await log.list();
      expect(list.length).toBe(3);

      const v = verifyChain(list);
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.length).toBe(3);
        expect(v.head).toBe(e3.entryHash);
      }
    });

    it('detects tampering when an entry rationale is altered', async () => {
      const log = new InMemoryAdjudicationLog();
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: 'Filing',
        decidedAt: '2026-01-01T00:00:00.000Z',
      });
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'escalated',
        rationale: 'Original text',
        decidedAt: '2026-01-02T00:00:00.000Z',
      });
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'accepted',
        rationale: 'Accepted',
        decidedAt: '2026-01-03T00:00:00.000Z',
      });

      const list = await log.list();
      // Tamper entry 2
      list[1] = { ...list[1]!, rationale: 'Tampered text' };

      const v = verifyChain(list);
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.brokenAtSeq).toBe(2);
        expect(v.reason).toBe('entry_hash_mismatch');
      }
    });

    it('detects prev_hash_mismatch when entry hash is recomputed', async () => {
      const log = new InMemoryAdjudicationLog();
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: '1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      });
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'escalated',
        rationale: '2',
        decidedAt: '2026-01-02T00:00:00.000Z',
      });
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'accepted',
        rationale: '3',
        decidedAt: '2026-01-03T00:00:00.000Z',
      });

      const list = await log.list();
      const tamperedEntry2: AdjudicationEntry = {
        ...list[1]!,
        rationale: 'tampered',
        entryHash: '',
      };
      tamperedEntry2.entryHash = computeEntryHash(tamperedEntry2);
      list[1] = tamperedEntry2;

      const v = verifyChain(list);
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.brokenAtSeq).toBe(3);
        expect(v.reason).toBe('prev_hash_mismatch');
      }
    });

    it('detects seq_gap when an entry is deleted', async () => {
      const log = new InMemoryAdjudicationLog();
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: '1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      });
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'escalated',
        rationale: '2',
        decidedAt: '2026-01-02T00:00:00.000Z',
      });
      await log.append({
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'accepted',
        rationale: '3',
        decidedAt: '2026-01-03T00:00:00.000Z',
      });

      const list = await log.list();
      list.splice(1, 1); // remove entry 2

      const v = verifyChain(list);
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.brokenAtSeq).toBe(3);
        expect(v.reason).toBe('seq_gap');
      }
    });
  });

  describe('computeEntryHash stability', () => {
    it('is stable for pinned fixture', () => {
      const hash = computeEntryHash({
        seq: 1,
        prevHash: GENESIS_HASH,
        disputeRef: 'a1b2c3d4e5f67890',
        anchorId: 'cowrie',
        category: 'wrong_amount',
        level: 'anchor',
        action: 'filed',
        rationale: 'Payout did not match quoted amount',
        decidedAt: '2026-01-01T00:00:00.000Z',
      });
      // Pinned: computed once and hard-coded, so any change to the hashed string breaks this test.
      expect(hash).toBe('8978b14f7a810fbb7402a2efb34e1488ef225b6aca8f28dd592a44dda3d4e476');
    });

    it('matches the documented string, recomputed independently of computeEntryHash', () => {
      const entry = {
        seq: 2,
        prevHash: 'f'.repeat(64),
        disputeRef: DREF,
        anchorId: 'cowrie',
        category: 'delayed' as const,
        level: 'review' as const,
        action: 'escalated' as const,
        rationale: 'Anchor did not answer within 72 hours.',
        decidedAt: '2026-02-03T04:05:06.000Z',
      };
      const documented =
        'stellar-intel/adjudication/v1\n' +
        JSON.stringify({
          action: entry.action,
          anchorId: entry.anchorId,
          category: entry.category,
          decidedAt: entry.decidedAt,
          disputeRef: entry.disputeRef,
          level: entry.level,
          prevHash: entry.prevHash,
          rationale: entry.rationale,
          seq: entry.seq,
        });
      expect(computeEntryHash(entry)).toBe(createHash('sha256').update(documented).digest('hex'));
    });
  });

  describe('public safety assertions', () => {
    it('accepts safe rationale', () => {
      expect(() => assertPublicSafe('Anchor confirmed the payout on 2026-11-02.')).not.toThrow();
    });

    it('rejects a Stellar G-address', () => {
      expect(() =>
        assertPublicSafe('Refund sent to GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
      ).toThrow(PublicTextError);
    });

    it('rejects an email address', () => {
      expect(() => assertPublicSafe('Contact user at support@example.com for help')).toThrow(
        PublicTextError
      );
    });

    it('rejects 9+ consecutive digits', () => {
      expect(() => assertPublicSafe('Account ref 1234567890 was credited')).toThrow(
        PublicTextError
      );
    });

    it('rejects more than 500 characters', () => {
      expect(() => assertPublicSafe('a'.repeat(501))).toThrow(PublicTextError);
    });

    it('rejects a muxed (M…) address, which embeds the G account', () => {
      // 69 base32 characters with no "G" in them, so only the muxed-address check can catch it.
      const muxed = 'M' + 'AB2CDEF3'.repeat(9).slice(0, 68);
      expect(muxed).toHaveLength(69);
      expect(muxed).not.toMatch(/G/);
      expect(() => assertPublicSafe(`Paid to ${muxed}`)).toThrow(PublicTextError);
    });
  });

  describe('publicDisputeRef', () => {
    it('returns 16 lowercase hex characters and differs for different ids', () => {
      const r1 = publicDisputeRef('dispute-1');
      const r2 = publicDisputeRef('dispute-2');
      expect(r1).toMatch(/^[0-9a-f]{16}$/);
      expect(r2).toMatch(/^[0-9a-f]{16}$/);
      expect(r1).not.toBe(r2);
    });
  });

  describe('type validation on append', () => {
    it('throws TypeError on invalid action', async () => {
      const log = new InMemoryAdjudicationLog();
      await expect(
        log.append({
          disputeRef: DREF,
          anchorId: 'cowrie',
          category: 'other',
          level: 'anchor',
          action: 'invalid_action' as AdjudicationAction,
          rationale: '',
          decidedAt: '2026-01-01T00:00:00.000Z',
        })
      ).rejects.toThrow(TypeError);
    });

    const valid: AdjudicationEntryInput = {
      disputeRef: DREF,
      anchorId: 'cowrie',
      category: 'other',
      level: 'anchor',
      action: 'filed',
      rationale: '',
      decidedAt: '2026-01-01T00:00:00.000Z',
    };

    it('throws TypeError when disputeRef is not a public dispute ref', async () => {
      const log = new InMemoryAdjudicationLog();
      // The internal dispute id must never reach the public log.
      await expect(log.append({ ...valid, disputeRef: 'dispute-1' })).rejects.toThrow(TypeError);
      await expect(log.append({ ...valid, disputeRef: DREF.toUpperCase() })).rejects.toThrow(
        TypeError
      );
      expect(await log.head()).toBeNull();
    });

    it('throws TypeError when decidedAt is not an ISO 8601 timestamp', async () => {
      const log = new InMemoryAdjudicationLog();
      for (const decidedAt of ['', 'yesterday', '2026-01-01', '2026-13-45T99:00:00Z']) {
        await expect(log.append({ ...valid, decidedAt })).rejects.toThrow(TypeError);
      }
      await expect(
        log.append({ ...valid, decidedAt: '2026-01-01T00:00:00+01:00' })
      ).resolves.toMatchObject({ seq: 1 });
    });

    it('throws TypeError on an unknown level or category', async () => {
      const log = new InMemoryAdjudicationLog();
      await expect(
        log.append({ ...valid, level: 'supreme' as AdjudicationEntryInput['level'] })
      ).rejects.toThrow(TypeError);
      await expect(
        log.append({ ...valid, category: 'other-ish' as AdjudicationEntryInput['category'] })
      ).rejects.toThrow(TypeError);
    });
  });

  describe('PostgresAdjudicationLog', () => {
    const input: AdjudicationEntryInput = {
      disputeRef: DREF,
      anchorId: 'cowrie',
      category: 'delayed',
      level: 'anchor',
      action: 'filed',
      rationale: '',
      decidedAt: '2026-01-01T00:00:00.000Z',
    };

    /** Empty log; the INSERT answers with each of `insertResults` in turn (another writer won). */
    function fakeDb(insertResults: Array<Array<{ seq: number }>>) {
      executor.query.mockReset();
      executor.query.mockImplementation(async (sql: string) => {
        if (sql.includes('CREATE TABLE')) return { rows: [] };
        if (sql.includes('INSERT INTO adjudication_log'))
          return { rows: insertResults.shift() ?? [] };
        return { rows: [] }; // SELECT … ORDER BY seq DESC LIMIT 1: no head yet
      });
    }

    const executedSql = () => executor.query.mock.calls.map(([sql]) => String(sql));

    beforeEach(() => {
      _resetAdjudicationSchema();
    });

    it('retries after losing the insert race and succeeds on attempt 3', async () => {
      fakeDb([[], [], [{ seq: 1 }]]);
      const entry = await new PostgresAdjudicationLog().append(input);

      expect(entry).toMatchObject({ seq: 1, prevHash: GENESIS_HASH });
      expect(entry.entryHash).toBe(computeEntryHash({ ...input, seq: 1, prevHash: GENESIS_HASH }));
      expect(
        executedSql().filter((sql) => sql.includes('INSERT INTO adjudication_log'))
      ).toHaveLength(3);
    });

    it('throws AdjudicationLogConflictError after three lost races', async () => {
      fakeDb([[], [], []]);
      await expect(new PostgresAdjudicationLog().append(input)).rejects.toBeInstanceOf(
        AdjudicationLogConflictError
      );
      expect(
        executedSql().filter((sql) => sql.includes('INSERT INTO adjudication_log'))
      ).toHaveLength(3);
    });

    it('inserts with ON CONFLICT (seq) DO NOTHING and never runs UPDATE or DELETE', async () => {
      fakeDb([[{ seq: 1 }]]);
      const log = new PostgresAdjudicationLog();
      await log.append(input);
      await log.list({ afterSeq: 0, limit: 10 });
      await log.head();

      const sql = executedSql();
      expect(sql.some((s) => s.includes('ON CONFLICT (seq) DO NOTHING'))).toBe(true);
      for (const statement of sql) {
        expect(statement).not.toMatch(/\bUPDATE\b/i);
        expect(statement).not.toMatch(/\bDELETE\b/i);
      }
    });

    it('validates before touching the database', async () => {
      fakeDb([[{ seq: 1 }]]);
      await expect(
        new PostgresAdjudicationLog().append({ ...input, disputeRef: 'dispute-1' })
      ).rejects.toThrow(TypeError);
      expect(executor.query).not.toHaveBeenCalled();
    });
  });

  describe('summarizeLog', () => {
    it('summarizes empty log', () => {
      expect(summarizeLog([])).toEqual({
        filed: 0,
        resolved: 0,
        accepted: 0,
        rejected: 0,
        open: 0,
        appealed: 0,
      });
    });

    it('handles filed only -> open 1', () => {
      const entries: AdjudicationEntry[] = [
        {
          seq: 1,
          disputeRef: 'ref-1',
          anchorId: 'cowrie',
          category: 'delayed',
          level: 'anchor',
          action: 'filed',
          rationale: 'Filed',
          decidedAt: '2026-01-01T00:00:00.000Z',
          prevHash: GENESIS_HASH,
          entryHash: 'hash-1',
        },
      ];
      expect(summarizeLog(entries)).toEqual({
        filed: 1,
        resolved: 0,
        accepted: 0,
        rejected: 0,
        open: 1,
        appealed: 0,
      });
    });

    it('handles filed + escalated + accepted -> resolved 1, accepted 1', () => {
      const entries: AdjudicationEntry[] = [
        {
          seq: 1,
          disputeRef: 'ref-1',
          anchorId: 'cowrie',
          category: 'delayed',
          level: 'anchor',
          action: 'filed',
          rationale: 'Filed',
          decidedAt: '2026-01-01T00:00:00.000Z',
          prevHash: GENESIS_HASH,
          entryHash: 'hash-1',
        },
        {
          seq: 2,
          disputeRef: 'ref-1',
          anchorId: 'cowrie',
          category: 'delayed',
          level: 'review',
          action: 'escalated',
          rationale: 'Escalated',
          decidedAt: '2026-01-02T00:00:00.000Z',
          prevHash: 'hash-1',
          entryHash: 'hash-2',
        },
        {
          seq: 3,
          disputeRef: 'ref-1',
          anchorId: 'cowrie',
          category: 'delayed',
          level: 'review',
          action: 'accepted',
          rationale: 'Accepted',
          decidedAt: '2026-01-03T00:00:00.000Z',
          prevHash: 'hash-2',
          entryHash: 'hash-3',
        },
      ];
      expect(summarizeLog(entries)).toEqual({
        filed: 1,
        resolved: 1,
        accepted: 1,
        rejected: 0,
        open: 0,
        appealed: 0,
      });
    });

    it('handles two disputes, one rejected -> resolved 1 open 1; appealed counted', () => {
      const entries: AdjudicationEntry[] = [
        {
          seq: 1,
          disputeRef: 'ref-1',
          anchorId: 'cowrie',
          category: 'delayed',
          level: 'anchor',
          action: 'filed',
          rationale: 'Filed 1',
          decidedAt: '2026-01-01T00:00:00.000Z',
          prevHash: GENESIS_HASH,
          entryHash: 'hash-1',
        },
        {
          seq: 2,
          disputeRef: 'ref-1',
          anchorId: 'cowrie',
          category: 'delayed',
          level: 'anchor',
          action: 'rejected',
          rationale: 'Rejected 1',
          decidedAt: '2026-01-02T00:00:00.000Z',
          prevHash: 'hash-1',
          entryHash: 'hash-2',
        },
        {
          seq: 3,
          disputeRef: 'ref-2',
          anchorId: 'mykobo',
          category: 'wrong_amount',
          level: 'anchor',
          action: 'filed',
          rationale: 'Filed 2',
          decidedAt: '2026-01-03T00:00:00.000Z',
          prevHash: 'hash-2',
          entryHash: 'hash-3',
        },
        {
          seq: 4,
          disputeRef: 'ref-2',
          anchorId: 'mykobo',
          category: 'wrong_amount',
          level: 'anchor',
          action: 'appealed',
          rationale: 'Appealed 2',
          decidedAt: '2026-01-04T00:00:00.000Z',
          prevHash: 'hash-3',
          entryHash: 'hash-4',
        },
      ];
      expect(summarizeLog(entries)).toEqual({
        filed: 2,
        resolved: 1,
        accepted: 0,
        rejected: 1,
        open: 1,
        appealed: 1,
      });
    });
  });
});
