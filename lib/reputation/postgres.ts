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

// ─── Postgres backend (Issue #128 / #219) — production ─────────────────────────
//
// The adapter depends only on this minimal executor, so it works with `pg`,
// `@vercel/postgres`, Neon, or any pool without bundling a driver. In prod:
//
//   import { Pool } from 'pg';
//   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
//   createReputationStore({ backend: 'postgres', executor: pool });

export interface SqlExecutor {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS outcome_log (
    intent_hash            TEXT PRIMARY KEY,
    anchor_id              TEXT NOT NULL,
    corridor               TEXT NOT NULL,
    direction              TEXT NOT NULL DEFAULT 'withdraw',
    quoted_rate            TEXT NOT NULL,
    delivered_rate         TEXT,
    quoted_amount          TEXT NOT NULL,
    delivered_amount       TEXT,
    settle_seconds         DOUBLE PRECISION,
    outcome                TEXT NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL,
    stellar_transaction_id TEXT,
    reconciled_at          TIMESTAMPTZ,
    disputed               BOOLEAN NOT NULL DEFAULT FALSE,
    disputed_reason        TEXT,
    published_at           TIMESTAMPTZ,
    oracle_tx_hash         TEXT,
    attested               BOOLEAN NOT NULL DEFAULT FALSE,
    signer_account         TEXT
  );

  CREATE TABLE IF NOT EXISTS probe_samples (
    domain        TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'uptime',
    corridor      TEXT,
    reachable     BOOLEAN NOT NULL,
    latency_ms    DOUBLE PRECISION NOT NULL,
    failure_type  TEXT,
    error         TEXT,
    probed_at     TIMESTAMPTZ NOT NULL
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
    observed_at  TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quote_history_anchor_corridor_observed
    ON quote_history (anchor_id, corridor, observed_at);
`;

// Tables created before migration 006 lack the attestation columns, and
// nothing applies `lib/reputation/migrations/` — this inline DDL is what runs.
// Kept as its own statement so it can be read (and skipped by the SQLite-backed
// test executor, which has no ADD COLUMN IF NOT EXISTS) independently.
export const MIGRATE_ATTESTATION_SQL = `
  ALTER TABLE outcome_log
    ADD COLUMN IF NOT EXISTS attested       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS signer_account TEXT;
`;

// Tables created before ONR031 lack the direction column; every pre-existing
// row is an off-ramp outcome, which the DEFAULT backfills.
export const MIGRATE_DIRECTION_SQL = `
  ALTER TABLE outcome_log
    ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'withdraw';
`;

function asString(v: unknown): string | null {
  return v == null ? null : String(v);
}

function fromDb(r: Record<string, unknown>): OutcomeLogRow {
  return {
    intentHash: String(r['intent_hash']),
    anchorId: String(r['anchor_id']),
    corridor: String(r['corridor']),
    direction: r['direction'] === 'deposit' ? 'deposit' : 'withdraw',
    quotedRate: String(r['quoted_rate']),
    deliveredRate: asString(r['delivered_rate']),
    quotedAmount: String(r['quoted_amount']),
    deliveredAmount: asString(r['delivered_amount']),
    settleSeconds: r['settle_seconds'] == null ? null : Number(r['settle_seconds']),
    outcome: String(r['outcome']) as OutcomeStatus,
    createdAt: new Date(r['created_at'] as string).toISOString(),
    stellarTransactionId: asString(r['stellar_transaction_id']),
    reconciledAt:
      r['reconciled_at'] == null ? null : new Date(r['reconciled_at'] as string).toISOString(),
    disputed: Boolean(r['disputed']),
    disputedReason: asString(r['disputed_reason']),
    publishedAt:
      r['published_at'] == null ? null : new Date(r['published_at'] as string).toISOString(),
    oracleTxHash: asString(r['oracle_tx_hash']),
    attested: r['attested'] === true || r['attested'] === 1 || r['attested'] === 't',
    signerAccount: asString(r['signer_account']),
  };
}

function fromProbeDb(r: Record<string, unknown>): ProbeLedgerRow {
  return {
    domain: String(r['domain']),
    kind: (r['kind'] as ProbeLedgerRow['kind']) ?? 'uptime',
    corridor: asString(r['corridor']),
    reachable: Boolean(r['reachable']),
    latencyMs: Number(r['latency_ms']),
    failureType: (r['failure_type'] as ProbeLedgerRow['failureType']) ?? null,
    error: (r['error'] as string) ?? null,
    probedAt: new Date(r['probed_at'] as string).toISOString(),
  };
}

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
    observedAt: new Date(r['observed_at'] as string).toISOString(),
  };
}

export class PostgresReputationStore implements ReputationStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly sql: SqlExecutor) {}

  private init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.sql
        .query(CREATE_TABLE_SQL)
        .then(() => this.sql.query(MIGRATE_ATTESTATION_SQL))
        .then(() => this.sql.query(MIGRATE_DIRECTION_SQL))
        .then(() => undefined)
        .catch((err: unknown) => {
          // Reset so a transient failure does not permanently poison the store.
          this.ready = null;
          throw err;
        });
    }
    return this.ready;
  }

  async append(row: OutcomeLogRow): Promise<boolean> {
    await this.init();
    // Insert-only. This was an upsert that overwrote every column, so a second
    // POST for a known intentHash could rewrite the outcome or clear
    // published_at/reconciled_at and push the row back through the publisher.
    const { rows } = await this.sql.query(
      `INSERT INTO outcome_log
         (intent_hash, anchor_id, corridor, direction, quoted_rate, delivered_rate, quoted_amount,
          delivered_amount, settle_seconds, outcome, created_at, stellar_transaction_id, reconciled_at,
          disputed, disputed_reason, published_at, oracle_tx_hash, attested, signer_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (intent_hash) DO NOTHING
       RETURNING intent_hash`,
      [
        row.intentHash,
        row.anchorId,
        row.corridor,
        row.direction,
        row.quotedRate,
        row.deliveredRate,
        row.quotedAmount,
        row.deliveredAmount,
        row.settleSeconds,
        row.outcome,
        row.createdAt,
        row.stellarTransactionId,
        row.reconciledAt,
        row.disputed ? 1 : 0,
        row.disputedReason,
        row.publishedAt,
        row.oracleTxHash,
        row.attested,
        row.signerAccount,
      ]
    );
    return rows.length > 0;
  }

  async query(filter: OutcomeQuery = {}): Promise<OutcomeLogRow[]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.anchorId) {
      params.push(filter.anchorId);
      where.push(`anchor_id = $${params.length}`);
    }
    if (filter.corridor) {
      params.push(filter.corridor);
      where.push(`corridor = $${params.length}`);
    }
    if (filter.direction) {
      params.push(filter.direction);
      where.push(`direction = $${params.length}`);
    }
    if (filter.pendingReconciliationOnly) {
      where.push(
        'delivered_amount IS NULL AND reconciled_at IS NULL AND stellar_transaction_id IS NOT NULL'
      );
    }
    if (!filter.includeUnattested) where.push('attested = TRUE');
    const sql = `SELECT * FROM outcome_log ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY created_at ASC`;
    const { rows } = await this.sql.query(sql, params);
    return rows.map(fromDb);
  }

  async markDelivered(intentHash: string, update: DeliveredUpdate): Promise<void> {
    await this.init();
    await this.sql.query(
      `UPDATE outcome_log
         SET delivered_amount = $2, delivered_rate = $3, reconciled_at = $4
       WHERE intent_hash = $1`,
      [intentHash, update.deliveredAmount, update.deliveredRate, update.reconciledAt]
    );
  }

  async markDisputed(intentHash: string, update: DisputedUpdate): Promise<void> {
    await this.init();
    await this.sql.query(
      `UPDATE outcome_log
         SET disputed = $2, disputed_reason = $3
       WHERE intent_hash = $1`,
      [intentHash, update.disputed ? 1 : 0, update.disputedReason]
    );
  }

  async recordProbeSample(row: ProbeLedgerRow): Promise<void> {
    await this.init();
    await this.sql.query(
      `INSERT INTO probe_samples (domain, kind, corridor, reachable, latency_ms, failure_type, error, probed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.domain,
        row.kind,
        row.corridor,
        row.reachable ? 1 : 0,
        row.latencyMs,
        row.failureType,
        row.error,
        row.probedAt,
      ]
    );
  }

  async queryProbeSamples(
    domain?: string,
    filter: ProbeSampleQuery = {}
  ): Promise<ProbeLedgerRow[]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
    if (domain) {
      params.push(domain);
      where.push(`domain = $${params.length}`);
    }
    if (filter.corridor) {
      params.push(filter.corridor);
      where.push(`corridor = $${params.length}`);
    }
    if (filter.kind) {
      params.push(filter.kind);
      where.push(`kind = $${params.length}`);
    }
    const sql = `SELECT * FROM probe_samples ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY probed_at ASC`;
    const { rows } = await this.sql.query(sql, params);
    return rows.map(fromProbeDb);
  }

  async compactProbes(cutoff: Date): Promise<number> {
    await this.init();
    const { rows } = await this.sql.query(
      `DELETE FROM probe_samples WHERE probed_at < $1 RETURNING domain`,
      [cutoff.toISOString()]
    );
    return rows.length;
  }

  async recordQuote(row: QuoteHistoryRow): Promise<void> {
    const q = QuoteHistoryRowSchema.parse(row);
    await this.init();
    await this.sql.query(
      `INSERT INTO quote_history
         (anchor_id, corridor, sell_asset, buy_asset, sell_amount, price, total_price, source, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        q.anchorId,
        q.corridor,
        q.sellAsset,
        q.buyAsset,
        q.sellAmount,
        q.price,
        q.totalPrice,
        q.source,
        q.observedAt,
      ]
    );
  }

  async queryQuotes(filter: QuoteQuery = {}): Promise<QuoteHistoryRow[]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.anchorId) {
      params.push(filter.anchorId);
      where.push(`anchor_id = $${params.length}`);
    }
    if (filter.corridor) {
      params.push(filter.corridor);
      where.push(`corridor = $${params.length}`);
    }
    if (filter.since) {
      params.push(filter.since.toISOString());
      where.push(`observed_at >= $${params.length}`);
    }
    const sql = `SELECT * FROM quote_history ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY observed_at ASC`;
    const { rows } = await this.sql.query(sql, params);
    return rows.map(fromQuoteDb);
  }

  async compactQuotes(cutoff: Date): Promise<number> {
    await this.init();
    const { rows } = await this.sql.query(
      `DELETE FROM quote_history WHERE observed_at < $1 RETURNING anchor_id`,
      [cutoff.toISOString()]
    );
    return rows.length;
  }

  async close(): Promise<void> {
    // Connection lifecycle is owned by the injected executor/pool.
  }
}
