import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createReputationStore,
  InMemoryReputationStore,
  PROBE_RETENTION_DAYS,
  type ReputationStore,
} from '@/lib/reputation/store';
import type { SqlExecutor } from '@/lib/reputation/postgres';
import type { ProbeLedgerRow } from '@/types/reputation';

// pg-compatible executor backed by SQLite (mirrors reputation-store.spec.ts).
class SqliteBackedPgExecutor implements SqlExecutor {
  private readonly db = new Database(':memory:');
  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    // Multi-statement DDL (CREATE TABLE / INDEX blocks) must use exec(), not prepare().
    const stmts = text
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    if (stmts.length > 1) {
      this.db.exec(text);
      return { rows: [] };
    }
    const stmt = this.db.prepare(text.replace(/\$(\d+)/g, (_m, n) => `@p${n}`));
    const bind: Record<string, unknown> = {};
    params.forEach((v, i) => {
      bind[`p${i + 1}`] = (typeof v === 'boolean' ? (v ? 1 : 0) : v) as never;
    });
    const args = params.length ? [bind] : [];
    if (/^\s*(select|delete.*returning)/i.test(text.trim())) {
      return { rows: stmt.all(...(args as never[])) as Record<string, unknown>[] };
    }
    stmt.run(...(args as never[]));
    return { rows: [] };
  }
}

function sample(domain: string, daysAgo: number): ProbeLedgerRow {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    domain,
    kind: 'uptime',
    corridor: null,
    reachable: true,
    latencyMs: 42,
    failureType: null,
    error: null,
    probedAt: at.toISOString(),
  };
}

function cutoff(): Date {
  return new Date(Date.now() - PROBE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function runRetentionSuite(label: string, makeStore: () => ReputationStore) {
  describe(label, () => {
    let store: ReputationStore;
    beforeEach(() => {
      store = makeStore();
    });

    it('retains an 89-day-old observation', async () => {
      await store.recordProbeSample(sample('cowrie.finance', 89));
      const pruned = await store.compactProbes(cutoff());
      expect(pruned).toBe(0);
      const rows = await store.queryProbeSamples();
      expect(rows).toHaveLength(1);
    });

    it('compacts a 91-day-old observation', async () => {
      await store.recordProbeSample(sample('cowrie.finance', 91));
      const pruned = await store.compactProbes(cutoff());
      expect(pruned).toBe(1);
      const rows = await store.queryProbeSamples();
      expect(rows).toHaveLength(0);
    });

    it('keeps recent observations and removes only stale ones', async () => {
      await store.recordProbeSample(sample('cowrie.finance', 89));
      await store.recordProbeSample(sample('cowrie.finance', 91));
      await store.recordProbeSample(sample('cowrie.finance', 1));
      const pruned = await store.compactProbes(cutoff());
      expect(pruned).toBe(1);
      const rows = await store.queryProbeSamples();
      expect(rows).toHaveLength(2);
    });

    it('filters by domain', async () => {
      await store.recordProbeSample(sample('cowrie.finance', 1));
      await store.recordProbeSample(sample('anclap.com', 1));
      const rows = await store.queryProbeSamples('cowrie.finance');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.domain).toBe('cowrie.finance');
    });

    it('returns samples ordered oldest first', async () => {
      await store.recordProbeSample(sample('cowrie.finance', 2));
      await store.recordProbeSample(sample('cowrie.finance', 5));
      await store.recordProbeSample(sample('cowrie.finance', 1));
      const rows = await store.queryProbeSamples('cowrie.finance');
      expect(rows[0]!.probedAt < rows[1]!.probedAt).toBe(true);
      expect(rows[1]!.probedAt < rows[2]!.probedAt).toBe(true);
    });
  });
}

runRetentionSuite('InMemoryReputationStore', () => new InMemoryReputationStore());

runRetentionSuite('SqliteReputationStore', () => createReputationStore({ backend: 'sqlite' }));

runRetentionSuite('PostgresReputationStore (SQLite-backed executor)', () =>
  createReputationStore({ backend: 'postgres', executor: new SqliteBackedPgExecutor() })
);
