import Database from 'better-sqlite3';
import type { OutcomeLogRow, OutcomeStatus, ProbeLedgerRow } from '@/types/reputation';
import type {
  DeliveredUpdate,
  DisputedUpdate,
  OutcomeQuery,
  ProbeSampleQuery,
  ReputationStore,
} from './store';

// ─── SQLite backend (Issue #128 / #219) — local/dev ────────────────────────────

type DbInstance = InstanceType<typeof Database>;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS outcome_log (
    intentHash           TEXT    NOT NULL PRIMARY KEY,
    anchorId             TEXT    NOT NULL,
    corridor             TEXT    NOT NULL,
    quotedRate           TEXT    NOT NULL,
    deliveredRate        TEXT,
    quotedAmount         TEXT    NOT NULL,
    deliveredAmount      TEXT,
    settleSeconds        REAL,
    outcome              TEXT    NOT NULL,
    createdAt            TEXT    NOT NULL,
    stellarTransactionId TEXT,
    reconciledAt         TEXT,
    disputed             INTEGER NOT NULL DEFAULT 0,
    disputed_reason      TEXT,
    publishedAt          TEXT,
    oracleTxHash         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_outcome_log_anchor ON outcome_log (anchorId);

  CREATE TABLE IF NOT EXISTS probe_samples (
    domain       TEXT    NOT NULL,
    kind         TEXT    NOT NULL DEFAULT 'uptime',
    corridor     TEXT,
    reachable    INTEGER NOT NULL,
    latencyMs    REAL    NOT NULL,
    failureType  TEXT,
    error        TEXT,
    probedAt     TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_probe_samples_domain ON probe_samples (domain);
  CREATE INDEX IF NOT EXISTS idx_probe_samples_domain_corridor ON probe_samples (domain, corridor);
`;

interface OutcomeLogRowDb {
  intentHash: string;
  anchorId: string;
  corridor: string;
  quotedRate: string;
  deliveredRate: string | null;
  quotedAmount: string;
  deliveredAmount: string | null;
  settleSeconds: number | null;
  outcome: string;
  createdAt: string;
  stellarTransactionId: string | null;
  reconciledAt: string | null;
  disputed: number;
  disputed_reason: string | null;
  publishedAt: string | null;
  oracleTxHash: string | null;
}

function fromDb(r: OutcomeLogRowDb): OutcomeLogRow {
  return {
    ...r,
    outcome: r.outcome as OutcomeStatus,
    disputed: r.disputed !== 0,
    disputedReason: r.disputed_reason,
  };
}

function fromProbeDb(r: Record<string, unknown>): ProbeLedgerRow {
  return {
    domain: String(r['domain']),
    kind: (r['kind'] as ProbeLedgerRow['kind']) ?? 'uptime',
    corridor: (r['corridor'] as string) ?? null,
    reachable: Boolean(r['reachable']),
    latencyMs: Number(r['latencyMs']),
    failureType: (r['failureType'] as ProbeLedgerRow['failureType']) ?? null,
    error: (r['error'] as string) ?? null,
    probedAt: String(r['probedAt']),
  };
}

export class SqliteReputationStore implements ReputationStore {
  private readonly db: DbInstance;

  constructor(path: string = ':memory:') {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(CREATE_TABLE_SQL);
  }

  async append(row: OutcomeLogRow): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO outcome_log
           (intentHash, anchorId, corridor, quotedRate, deliveredRate, quotedAmount,
            deliveredAmount, settleSeconds, outcome, createdAt, stellarTransactionId, reconciledAt,
            disputed, disputed_reason, publishedAt, oracleTxHash)
         VALUES
           (@intentHash, @anchorId, @corridor, @quotedRate, @deliveredRate, @quotedAmount,
            @deliveredAmount, @settleSeconds, @outcome, @createdAt, @stellarTransactionId, @reconciledAt,
            @disputed, @disputedReason, @publishedAt, @oracleTxHash)`
      )
      .run({ ...row, disputed: row.disputed ? 1 : 0 });
  }

  async query(filter: OutcomeQuery = {}): Promise<OutcomeLogRow[]> {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.anchorId) {
      where.push('anchorId = @anchorId');
      params['anchorId'] = filter.anchorId;
    }
    if (filter.corridor) {
      where.push('corridor = @corridor');
      params['corridor'] = filter.corridor;
    }
    if (filter.pendingReconciliationOnly) {
      where.push(
        'deliveredAmount IS NULL AND reconciledAt IS NULL AND stellarTransactionId IS NOT NULL'
      );
    }
    const sql = `SELECT * FROM outcome_log ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY createdAt ASC`;
    return (this.db.prepare(sql).all(params) as OutcomeLogRowDb[]).map(fromDb);
  }

  async markDelivered(intentHash: string, update: DeliveredUpdate): Promise<void> {
    this.db
      .prepare(
        `UPDATE outcome_log
           SET deliveredAmount = @deliveredAmount,
               deliveredRate = @deliveredRate,
               reconciledAt = @reconciledAt
         WHERE intentHash = @intentHash`
      )
      .run({ ...update, intentHash });
  }

  async markDisputed(intentHash: string, update: DisputedUpdate): Promise<void> {
    this.db
      .prepare(
        `UPDATE outcome_log
           SET disputed = @disputed,
               disputed_reason = @disputedReason
         WHERE intentHash = @intentHash`
      )
      .run({
        disputed: update.disputed ? 1 : 0,
        disputedReason: update.disputedReason,
        intentHash,
      });
  }

  async recordProbeSample(row: ProbeLedgerRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO probe_samples (domain, kind, corridor, reachable, latencyMs, failureType, error, probedAt)
         VALUES (@domain, @kind, @corridor, @reachable, @latencyMs, @failureType, @error, @probedAt)`
      )
      .run({ ...row, reachable: row.reachable ? 1 : 0 });
  }

  async queryProbeSamples(
    domain?: string,
    filter: ProbeSampleQuery = {}
  ): Promise<ProbeLedgerRow[]> {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (domain) {
      where.push('domain = @domain');
      params['domain'] = domain;
    }
    if (filter.corridor) {
      where.push('corridor = @corridor');
      params['corridor'] = filter.corridor;
    }
    if (filter.kind) {
      where.push('kind = @kind');
      params['kind'] = filter.kind;
    }
    const sql = `SELECT * FROM probe_samples ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY probedAt ASC`;
    return (this.db.prepare(sql).all(params) as Array<Record<string, unknown>>).map(fromProbeDb);
  }

  async compactProbes(cutoff: Date): Promise<number> {
    const result = this.db
      .prepare(`DELETE FROM probe_samples WHERE probedAt < @cutoff`)
      .run({ cutoff: cutoff.toISOString() });
    return result.changes;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
