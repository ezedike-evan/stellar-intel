import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Keypair } from '@stellar/stellar-sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeLatencyPercentiles,
  createReputationStore,
  type ReputationStore,
} from '@/lib/reputation/store';
import type { SqlExecutor } from '@/lib/reputation/postgres';
import { OutcomeLogRowSchema, toOutcomeLogRow } from '@/lib/reputation/schema';
import type { OutcomeLogRow, ProbeLedgerRow } from '@/types/reputation';

// A pg-compatible executor backed by in-memory SQLite, so the Postgres adapter's
// real SQL ($1 params, ON CONFLICT DO NOTHING RETURNING) is genuinely exercised.
// SQLite has no ADD COLUMN IF NOT EXISTS; the driver's upgrade-in-place ALTER is
// skipped here because the CREATE TABLE already carries the new columns.
class SqliteBackedPgExecutor implements SqlExecutor {
  private readonly db = new Database(':memory:');
  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    // Postgres $n params are positional-by-number and can appear out of textual
    // order, so map them to better-sqlite3 named params (@pN) for a faithful run.
    // Multi-statement DDL (CREATE TABLE / INDEX blocks) must use exec(), not prepare().
    if (/ADD COLUMN IF NOT EXISTS/i.test(text)) return { rows: [] };
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
    const sql = text.trim();
    if (/^select\b/i.test(sql) || /\breturning\b/i.test(sql)) {
      return { rows: stmt.all(...(args as never[])) as Record<string, unknown>[] };
    }
    stmt.run(...(args as never[]));
    return { rows: [] };
  }
}

const SIGNER = Keypair.random().publicKey();

function row(over: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return {
    ...toOutcomeLogRow(
      {
        intentHash: 'f'.repeat(64),
        anchorId: 'cowrie',
        corridor: 'usdc-ngn',
        quotedRate: '1500.0',
        quotedAmount: '100',
        outcome: 'completed',
        stellarTransactionId: 'a'.repeat(64),
        publicKey: SIGNER,
        signature: 'unused-here',
      },
      new Date('2026-06-04T12:00:00.000Z')
    ),
    intentHash: `h-${Math.random().toString(16).slice(2)}`,
    ...over,
  };
}

const backends: Array<[string, () => ReputationStore]> = [
  ['memory', () => createReputationStore({ backend: 'memory' })],
  ['sqlite', () => createReputationStore({ backend: 'sqlite' })],
  [
    'postgres',
    () => createReputationStore({ backend: 'postgres', executor: new SqliteBackedPgExecutor() }),
  ],
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

  it('is insert-only on intentHash: a duplicate never overwrites the stored row', async () => {
    store = make();
    expect(await store.append(row({ intentHash: 'dup', outcome: 'completed' }))).toBe(true);
    expect(await store.append(row({ intentHash: 'dup', outcome: 'refunded' }))).toBe(false);
    const all = await store.query({});
    expect(all).toHaveLength(1);
    expect(all[0]?.outcome).toBe('completed');
  });

  it('a duplicate cannot reset publish or reconcile state', async () => {
    store = make();
    await store.append(
      row({
        intentHash: 'pub',
        reconciledAt: '2026-06-04T12:05:00.000Z',
        deliveredAmount: '149000',
        publishedAt: '2026-06-04T12:10:00.000Z',
        oracleTxHash: 'b'.repeat(64),
      })
    );
    expect(await store.append(row({ intentHash: 'pub' }))).toBe(false);
    const [stored] = await store.query({});
    expect(stored?.publishedAt).toBe('2026-06-04T12:10:00.000Z');
    expect(stored?.oracleTxHash).toBe('b'.repeat(64));
    expect(stored?.reconciledAt).toBe('2026-06-04T12:05:00.000Z');
    expect(stored?.deliveredAmount).toBe('149000');
  });

  it('persists the attestation and hides unattested rows unless asked', async () => {
    store = make();
    await store.append(row({ intentHash: 'signed' }));
    await store.append(row({ intentHash: 'unsigned', attested: false, signerAccount: null }));

    const scored = await store.query({});
    expect(scored.map((r) => r.intentHash)).toEqual(['signed']);
    expect(scored[0]?.attested).toBe(true);
    expect(scored[0]?.signerAccount).toBe(SIGNER);

    const raw = await store.query({ includeUnattested: true });
    expect(raw.map((r) => r.intentHash).sort()).toEqual(['signed', 'unsigned']);
    expect(raw.find((r) => r.intentHash === 'unsigned')?.attested).toBe(false);
  });

  it('backfills delivery and drops the row from the pending-reconciliation set', async () => {
    store = make();
    await store.append(
      row({ intentHash: 'r', deliveredAmount: null, stellarTransactionId: 'c'.repeat(64) })
    );

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

describe('SQLite upgrade in place (migration 006)', () => {
  it('adds the attestation columns to a pre-006 database; old rows stay unattested', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-006-'));
    const path = join(dir, 'rep.db');
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE outcome_log (
        intentHash TEXT NOT NULL PRIMARY KEY, anchorId TEXT NOT NULL, corridor TEXT NOT NULL,
        quotedRate TEXT NOT NULL, deliveredRate TEXT, quotedAmount TEXT NOT NULL,
        deliveredAmount TEXT, settleSeconds REAL, outcome TEXT NOT NULL, createdAt TEXT NOT NULL,
        stellarTransactionId TEXT, reconciledAt TEXT, disputed INTEGER NOT NULL DEFAULT 0,
        disputed_reason TEXT, publishedAt TEXT, oracleTxHash TEXT
      );
      INSERT INTO outcome_log (intentHash, anchorId, corridor, quotedRate, quotedAmount, outcome, createdAt)
      VALUES ('legacy', 'cowrie', 'usdc-ngn', '1500', '100', 'completed', '2026-06-01T00:00:00.000Z');
    `);
    legacy.close();

    const store = createReputationStore({ backend: 'sqlite', sqlitePath: path });
    try {
      expect(await store.query({})).toHaveLength(0);
      const [old] = await store.query({ includeUnattested: true });
      expect(old?.intentHash).toBe('legacy');
      expect(old?.attested).toBe(false);
      expect(old?.signerAccount).toBeNull();

      await store.append(row({ intentHash: 'new' }));
      expect((await store.query({})).map((r) => r.intentHash)).toEqual(['new']);
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
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

function probeRow(over: Partial<ProbeLedgerRow> = {}): ProbeLedgerRow {
  return {
    domain: 'stellar.moneygram.com',
    kind: 'uptime',
    corridor: null,
    reachable: true,
    latencyMs: 120,
    failureType: null,
    error: null,
    probedAt: '2026-07-20T10:00:00.000Z',
    ...over,
  };
}

describe.each(backends)('Probe ledger — %s backend', (_name, make) => {
  let store: ReputationStore;
  afterEach(async () => {
    await store?.close();
  });

  it('records and queries probe samples by domain', async () => {
    store = make();
    await store.recordProbeSample(probeRow({ domain: 'a.example', reachable: true }));
    await store.recordProbeSample(
      probeRow({ domain: 'b.example', reachable: false, latencyMs: 0 })
    );

    const all = await store.queryProbeSamples();
    expect(all).toHaveLength(2);

    const aOnly = await store.queryProbeSamples('a.example');
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0]?.reachable).toBe(true);
  });

  it('returns probe samples sorted oldest first', async () => {
    store = make();
    await store.recordProbeSample(
      probeRow({ domain: 'x.example', probedAt: '2026-07-20T12:00:00.000Z' })
    );
    await store.recordProbeSample(
      probeRow({ domain: 'x.example', probedAt: '2026-07-20T10:00:00.000Z' })
    );

    const samples = await store.queryProbeSamples('x.example');
    expect(samples[0]?.probedAt).toBe('2026-07-20T10:00:00.000Z');
    expect(samples[1]?.probedAt).toBe('2026-07-20T12:00:00.000Z');
  });

  it('stores failure type and error metadata', async () => {
    store = make();
    await store.recordProbeSample(
      probeRow({
        domain: 'down.example',
        reachable: false,
        failureType: 'dns',
        error: 'ENOTFOUND',
        latencyMs: 0,
      })
    );

    const samples = await store.queryProbeSamples('down.example');
    expect(samples[0]?.failureType).toBe('dns');
    expect(samples[0]?.error).toBe('ENOTFOUND');
    expect(samples[0]?.reachable).toBe(false);
  });

  it('filters probe samples by kind and corridor (#D005)', async () => {
    store = make();
    await store.recordProbeSample(probeRow({ domain: 'a.example' }));
    await store.recordProbeSample(
      probeRow({ domain: 'a.example', kind: 'quote', corridor: 'usdc-ngn', latencyMs: 300 })
    );
    await store.recordProbeSample(
      probeRow({ domain: 'a.example', kind: 'quote', corridor: 'usdc-kes', latencyMs: 400 })
    );

    const uptimeOnly = await store.queryProbeSamples('a.example', { kind: 'uptime' });
    expect(uptimeOnly).toHaveLength(1);
    expect(uptimeOnly[0]?.corridor).toBeNull();

    const ngnQuotes = await store.queryProbeSamples('a.example', {
      kind: 'quote',
      corridor: 'usdc-ngn',
    });
    expect(ngnQuotes).toHaveLength(1);
    expect(ngnQuotes[0]?.latencyMs).toBe(300);
  });
});

describe('computeLatencyPercentiles', () => {
  it('computes p50/p95 over reachable rows within the rolling window', () => {
    const rows: ProbeLedgerRow[] = [100, 200, 300, 400, 500].map((latencyMs, i) =>
      probeRow({
        domain: 'anchor.example',
        kind: 'quote',
        corridor: 'usdc-ngn',
        latencyMs,
        probedAt: `2026-07-20T10:0${i}:00.000Z`,
      })
    );

    const stats = computeLatencyPercentiles(rows);
    expect(stats).toEqual({ p50Ms: 300, p95Ms: 500, sampleCount: 5 });
  });

  it('excludes unreachable rows and honors a custom window size', () => {
    const rows: ProbeLedgerRow[] = [
      probeRow({ latencyMs: 100, probedAt: '2026-07-20T10:00:00.000Z' }),
      probeRow({ latencyMs: 9000, reachable: false, probedAt: '2026-07-20T10:01:00.000Z' }),
      probeRow({ latencyMs: 900, probedAt: '2026-07-20T10:02:00.000Z' }),
      probeRow({ latencyMs: 900, probedAt: '2026-07-20T10:03:00.000Z' }),
    ];

    expect(computeLatencyPercentiles(rows, 2)).toEqual({
      p50Ms: 900,
      p95Ms: 900,
      sampleCount: 2,
    });
  });

  it('returns null when there are no reachable rows', () => {
    expect(computeLatencyPercentiles([])).toBeNull();
    expect(computeLatencyPercentiles([probeRow({ reachable: false, latencyMs: 0 })])).toBeNull();
  });
});
