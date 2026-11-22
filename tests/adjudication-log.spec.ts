// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAdjudicationLog,
  PostgresAdjudicationLog,
  computeEntryHash,
  verifyChain,
  publicDisputeRef,
  assertPublicSafe,
  PublicTextError,
  AdjudicationLogConflictError,
  GENESIS_HASH,
  type AdjudicationEntry,
} from '@/lib/reputation/adjudication-log';

describe('adjudication-log', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('InMemoryAdjudicationLog', () => {
    it('appends entries sequentially with linked hashes and verifies chain', async () => {
      const log = new InMemoryAdjudicationLog();
      const e1 = await log.append({
        disputeRef: 'dref1',
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
        disputeRef: 'dref1',
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
        disputeRef: 'dref1',
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
        disputeRef: 'dref1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: 'Filing',
        decidedAt: '2026-01-01T00:00:00.000Z',
      });
      await log.append({
        disputeRef: 'dref1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'escalated',
        rationale: 'Original text',
        decidedAt: '2026-01-02T00:00:00.000Z',
      });
      await log.append({
        disputeRef: 'dref1',
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
        disputeRef: 'dref1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: '1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      });
      await log.append({
        disputeRef: 'dref1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'escalated',
        rationale: '2',
        decidedAt: '2026-01-02T00:00:00.000Z',
      });
      await log.append({
        disputeRef: 'dref1',
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
        disputeRef: 'dref1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: '1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      });
      await log.append({
        disputeRef: 'dref1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'review',
        action: 'escalated',
        rationale: '2',
        decidedAt: '2026-01-02T00:00:00.000Z',
      });
      await log.append({
        disputeRef: 'dref1',
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
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toBe(
        computeEntryHash({
          seq: 1,
          prevHash: GENESIS_HASH,
          disputeRef: 'a1b2c3d4e5f67890',
          anchorId: 'cowrie',
          category: 'wrong_amount',
          level: 'anchor',
          action: 'filed',
          rationale: 'Payout did not match quoted amount',
          decidedAt: '2026-01-01T00:00:00.000Z',
        })
      );
    });
  });

  describe('public safety assertions', () => {
    it('accepts safe rationale', () => {
      expect(() =>
        assertPublicSafe('Anchor confirmed the payout on 2026-11-02.')
      ).not.toThrow();
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
          disputeRef: 'ref',
          anchorId: 'cowrie',
          category: 'other',
          level: 'anchor',
          action: 'invalid_action' as any,
          rationale: '',
          decidedAt: '2026-01-01T00:00:00.000Z',
        })
      ).rejects.toThrow(TypeError);
    });
  });
});
