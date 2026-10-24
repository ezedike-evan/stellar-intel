import Database from 'better-sqlite3';
import type {
  OutcomeLogRow,
  OutcomeStatus,
  ProbeLedgerRow,
  QuoteHistoryRow,
  QuoteSource,
} from '@/types/reputation';
import { QuoteHistoryRowSchema } from './schema';
import type {
  DeliveredUpdate,
  DisputedUpdate,
  OutcomeQuery,
  ProbeSampleQuery,
  QuoteQuery,
  ReputationStore,
} from './store';

// ─── SQLite backend (Issue #128 / #219) — local/dev ────────────────────────────

type DbInstance = InstanceType<typeof Database>;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS outcome_log (
    intentHash           TEXT    NOT NULL PRIMARY KEY,
    anchorId             TEXT    NOT NULL,
    corridor             TEXT    NOT NULL,
    direction            TEXT    NOT NULL DEFAULT 'withdraw',
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
    oracleTxHash         TEXT,
    attested             INTEGER NOT NULL DEFAULT 0,
    signerAccount        TEXT
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

  CREATE TABLE IF NOT EXISTS quote_history (
    anchor_id    TEXT NOT NULL,
    corridor     TEXT NOT NULL,
    sell_asset   TEXT NOT NULL,
    buy_asset    TEXT NOT NULL,
    sell_amount  TEXT NOT NULL,
    price        TEXT NOT NULL,
    total_price  TEXT NOT NULL,
    source       TEXT NOT NULL,
    observed_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quote_history_anchor_corridor_observed
    ON quote_history (anchor_id, corridor, observed_at);
`;

function fromQuoteDb(r: Record<string, unknown>): QuoteHistoryRow {
  return {
    anchorId: String(r['anchor_id']),
    corridor: String(r['corridor']),
    sellAsset: String(r['sell_asset']),
    buyAsset: String(r['buy_asset']),
    sellAmount: String(r['sell_amount']),
    price: String(r['price']),
    totalPrice: String(r['total_price']),
    source: String(r['source']) as QuoteSource,
    observedAt: String(r['observed_at']),
  };
}

interface OutcomeLogRowDb {
  intentHash: string;
  anchorId: string;
  corridor: string;
  direction: string;
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
  attested: number;
  signerAccount: string | null;
}

function fromDb(r: OutcomeLogRowDb): OutcomeLogRow {
  return {
    ...r,
    direction: r.direction === 'deposit' ? 'deposit' : 'withdraw',
    outcome: r.outcome as OutcomeStatus,
    disputed: r.disputed !== 0,
    disputedReason: r.disputed_reason,
    attested: r.attested !== 0,
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
    this.migrateAttestation();
  }

  /**
   * Adds the attestation columns (migration 006) to a database file created
   * before they existed. SQLite has no ADD COLUMN IF NOT EXISTS, so check first.
   */
  private migrateAttestation(): void {
    const columns = new Set(
      (this.db.prepare(`PRAGMA table_info(outcome_log)`).all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!columns.has('attested')) {
      this.db.exec(`ALTER TABLE outcome_log ADD COLUMN attested INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columns.has('signerAccount')) {
      this.db.exec(`ALTER TABLE outcome_log ADD COLUMN signerAccount TEXT`);
    }
    // ONR031: pre-existing rows are all off-ramp outcomes.
    if (!columns.has('direction')) {
      this.db.exec(`ALTER TABLE outcome_log ADD COLUMN direction TEXT NOT NULL DEFAULT 'withdraw'`);
    }
  }

  async append(row: OutcomeLogRow): Promise<boolean> {
    // Insert-only: an existing row (and its reconcile/publish state) is never
    // replaced. `changes` is 0 when the intentHash was already present.
    const result = this.db
      .prepare(
        `INSERT INTO outcome_log
           (intentHash, anchorId, corridor, direction, quotedRate, deliveredRate, quotedAmount,
            deliveredAmount, settleSeconds, outcome, createdAt, stellarTransactionId, reconciledAt,
            disputed, disputed_reason, publishedAt, oracleTxHash, attested, signerAccount)
         VALUES
           (@intentHash, @anchorId, @corridor, @direction, @quotedRate, @deliveredRate, @quotedAmount,
            @deliveredAmount, @settleSeconds, @outcome, @createdAt, @stellarTransactionId, @reconciledAt,
            @disputed, @disputedReason, @publishedAt, @oracleTxHash, @attested, @signerAccount)
         ON CONFLICT (intentHash) DO NOTHING`
      )
      .run({ ...row, disputed: row.disputed ? 1 : 0, attested: row.attested ? 1 : 0 });
    return result.changes > 0;
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
    if (filter.direction) {
      where.push('direction = @direction');
      params['direction'] = filter.direction;
    }
    if (filter.pendingReconciliationOnly) {
      where.push(
        'deliveredAmount IS NULL AND reconciledAt IS NULL AND stellarTransactionId IS NOT NULL'
      );
    }
    if (!filter.includeUnattested) where.push('attested = 1');
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

  async recordQuote(row: QuoteHistoryRow): Promise<void> {
    const q = QuoteHistoryRowSchema.parse(row);
    this.db
      .prepare(
        `INSERT INTO quote_history
           (anchor_id, corridor, sell_asset, buy_asset, sell_amount, price, total_price, source, observed_at)
         VALUES (@anchorId, @corridor, @sellAsset, @buyAsset, @sellAmount, @price, @totalPrice, @source, @observedAt)`
      )
      .run({ ...q });
  }

  async queryQuotes(filter: QuoteQuery = {}): Promise<QuoteHistoryRow[]> {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.anchorId) {
      where.push('anchor_id = @anchorId');
      params['anchorId'] = filter.anchorId;
    }
    if (filter.corridor) {
      where.push('corridor = @corridor');
      params['corridor'] = filter.corridor;
    }
    if (filter.since) {
      where.push('observed_at >= @since');
      params['since'] = filter.since.toISOString();
    }
    const sql = `SELECT * FROM quote_history ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY observed_at ASC`;
    return (this.db.prepare(sql).all(params) as Array<Record<string, unknown>>).map(fromQuoteDb);
  }

  async compactQuotes(cutoff: Date): Promise<number> {
    const result = this.db
      .prepare(`DELETE FROM quote_history WHERE observed_at < @cutoff`)
      .run({ cutoff: cutoff.toISOString() });
    return result.changes;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
