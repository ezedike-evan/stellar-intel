import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createReputationStore, type ReputationStore } from '@/lib/reputation/store';
import type { SqlExecutor } from '@/lib/reputation/postgres';
import { OutcomeLogRowSchema, toOutcomeLogRow } from '@/lib/reputation/schema';
import type { OutcomeLogRow } from '@/types/reputation';

// A pg-compatible executor backed by in-memory SQLite, so the Postgres adapter's
// real SQL ($1 params, ON CONFLICT upsert) is genuinely exercised in tests.
class SqliteBackedPgExecutor implements SqlExecutor {
  private readonly db = new Database(':memory:');
  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    // Postgres $n params are positional-by-number and can appear out of textual
    // order, so map them to better-sqlite3 named params (@pN) for a faithful run.
    const stmt = this.db.prepare(text.replace(/\$(\d+)/g, (_m, n) => `@p${n}`));
    const bind: Record<string, unknown> = {};
    params.forEach((v, i) => {
      bind[`p${i + 1}`] = v as never;
    });
    const args = params.length ? [bind] : [];
    if (/^\s*select/i.test(text)) {
      return { rows: stmt.all(...(args as never[])) as Record<string, unknown>[] };
    }
    stmt.run(...(args as never[]));
    return { rows: [] };
  }
}

function row(over: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return toOutcomeLogRow(
    {
      intentHash: `h-${Math.random().toString(16).slice(2)}`,
      anchorId: 'cowrie',
      corridor: 'USDC-NGN',
      quotedRate: '1500.0',
      quotedAmount: '100',
      outcome: 'completed',
      stellarTransactionId: 'stellar-tx-1',
      ...over,
    },
    new Date('2026-06-04T12:00:00.000Z')
  );
}

const backends: Array<[string, () => ReputationStore]> = [
  ['memory', () => createReputationStore({ backend: 'memory' })],
  ['sqlite', () => createReputationStore({ backend: 'sqlite' })],
  ['postgres', () => createReputationStore({ backend: 'postgres', executor: new SqliteBackedPgExecutor() })],
];

describe.each(backends)('ReputationStore conformance — %s backend', (_name, make) => {
  let store: ReputationStore;
  afterEach(async () => {
    await store?.close();
  });

  it('appends and queries by anchor', async () => {
    store = make();
    await store.append(row({ intentHash: 'a', anchorId: 'cowrie' }));
    await store.append(row({ intentHash: 'b', anchorId: 'moneygram' }));

    const cowrie = await store.query({ anchorId: 'cowrie' });
    expect(cowrie).toHaveLength(1);
    expect(cowrie[0]?.intentHash).toBe('a');
  });

  it('is idempotent on intentHash', async () => {
    store = make();
    await store.append(row({ intentHash: 'dup', outcome: 'completed' }));
    await store.append(row({ intentHash: 'dup', outcome: 'refunded' }));
    const all = await store.query({});
    expect(all).toHaveLength(1);
    expect(all[0]?.outcome).toBe('refunded');
  });

  it('backfills delivery and drops the row from the pending-reconciliation set', async () => {
    store = make();
    await store.append(row({ intentHash: 'r', deliveredAmount: null, stellarTransactionId: 'tx-r' }));

    expect(await store.query({ pendingReconciliationOnly: true })).toHaveLength(1);

    await store.markDelivered('r', {
      deliveredAmount: '149000',
      deliveredRate: '1490.0',
      reconciledAt: '2026-06-04T12:05:00.000Z',
    });

    expect(await store.query({ pendingReconciliationOnly: true })).toHaveLength(0);
    const [updated] = await store.query({ anchorId: 'cowrie' });
    expect(updated?.deliveredAmount).toBe('149000');
    expect(updated?.reconciledAt).toBe('2026-06-04T12:05:00.000Z');
  });
});

describe('OutcomeLogRowSchema (#218)', () => {
  it('accepts a well-formed row', () => {
    expect(() => OutcomeLogRowSchema.parse(row())).not.toThrow();
  });

  it('rejects an unknown outcome and a non-decimal rate', () => {
    expect(OutcomeLogRowSchema.safeParse(row({ outcome: 'bogus' as never })).success).toBe(false);
    expect(OutcomeLogRowSchema.safeParse(row({ quotedRate: 'NaN' })).success).toBe(false);
  });
});
