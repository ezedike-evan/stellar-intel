import { getSqlExecutor, hasDatabaseUrl } from '@/lib/reputation/pool';

// ─── Dispute store ──────────────────────────────────────────────────────────────
//
// Filed disputes used to sit in a module-level Map inside the public dispute
// route, and the admin route kept its own, separate, never-populated Map — so an
// admin could never see or resolve a real dispute. Both routes now go through
// this one store.
//
// Same shape as the webhook store: in-memory by default, Postgres when
// DATABASE_URL is set, with the DDL run inline once per process because nothing
// applies lib/reputation/migrations/.

/** A dispute is `open` until an admin accepts or rejects it. */
export type DisputeStatus = 'open' | 'accepted' | 'rejected';

export interface Dispute {
  id: string;
  intentHash: string;
  publicKey: string;
  anchorId: string;
  reason: string;
  status: DisputeStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DisputeStore {
  create(record: Dispute): Promise<void>;
  /** Every dispute, newest first. */
  list(): Promise<Dispute[]>;
  get(id: string): Promise<Dispute | null>;
  /** Resolves a dispute; null when the id is unknown. */
  resolve(id: string, status: 'accepted' | 'rejected', resolvedAt: string): Promise<Dispute | null>;
}

function newestFirst(a: Dispute, b: Dispute): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export class InMemoryDisputeStore implements DisputeStore {
  private readonly disputes = new Map<string, Dispute>();

  async create(record: Dispute): Promise<void> {
    this.disputes.set(record.id, { ...record });
  }

  async list(): Promise<Dispute[]> {
    return Array.from(this.disputes.values(), (d) => ({ ...d })).sort(newestFirst);
  }

  async get(id: string): Promise<Dispute | null> {
    const found = this.disputes.get(id);
    return found ? { ...found } : null;
  }

  async resolve(
    id: string,
    status: 'accepted' | 'rejected',
    resolvedAt: string
  ): Promise<Dispute | null> {
    const found = this.disputes.get(id);
    if (!found) return null;
    const updated: Dispute = { ...found, status, resolvedAt };
    this.disputes.set(id, updated);
    return { ...updated };
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS disputes (
    id          TEXT PRIMARY KEY,
    intent_hash TEXT NOT NULL,
    public_key  TEXT NOT NULL,
    anchor_id   TEXT NOT NULL,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TEXT NOT NULL,
    resolved_at TEXT
  );
`;

let schemaReady: Promise<void> | null = null;

/** Creates the table once per process. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getSqlExecutor()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err: unknown) => {
        // Reset so a transient failure does not permanently poison the process.
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

/** Test seam: forget that the schema was created. */
export function _resetDisputeSchema(): void {
  schemaReady = null;
}

function toDispute(row: Record<string, unknown>): Dispute {
  return {
    id: String(row['id']),
    intentHash: String(row['intent_hash']),
    publicKey: String(row['public_key']),
    anchorId: String(row['anchor_id']),
    reason: String(row['reason']),
    status: String(row['status']) as DisputeStatus,
    createdAt: String(row['created_at']),
    resolvedAt: row['resolved_at'] == null ? null : String(row['resolved_at']),
  };
}

export class PostgresDisputeStore implements DisputeStore {
  async create(record: Dispute): Promise<void> {
    await ensureSchema();
    await getSqlExecutor().query(
      `INSERT INTO disputes
         (id, intent_hash, public_key, anchor_id, reason, status, created_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.id,
        record.intentHash,
        record.publicKey,
        record.anchorId,
        record.reason,
        record.status,
        record.createdAt,
        record.resolvedAt,
      ]
    );
  }

  async list(): Promise<Dispute[]> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      'SELECT * FROM disputes ORDER BY created_at DESC'
    );
    return rows.map(toDispute);
  }

  async get(id: string): Promise<Dispute | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query('SELECT * FROM disputes WHERE id = $1', [id]);
    return rows[0] ? toDispute(rows[0]) : null;
  }

  async resolve(
    id: string,
    status: 'accepted' | 'rejected',
    resolvedAt: string
  ): Promise<Dispute | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      'UPDATE disputes SET status = $2, resolved_at = $3 WHERE id = $1 RETURNING *',
      [id, status, resolvedAt]
    );
    return rows[0] ? toDispute(rows[0]) : null;
  }
}

let override: DisputeStore | null = null;
let memoryStore: InMemoryDisputeStore | null = null;
let postgresStore: PostgresDisputeStore | null = null;

/** Postgres when `DATABASE_URL` is set, otherwise a per-process in-memory store. */
export function getDisputeStore(): DisputeStore {
  if (override) return override;
  if (hasDatabaseUrl()) return (postgresStore ??= new PostgresDisputeStore());
  return (memoryStore ??= new InMemoryDisputeStore());
}

/** Test seam: pin a store, or pass null to drop the pin and the in-memory state. */
export function _setDisputeStore(store: DisputeStore | null): void {
  override = store;
  if (store === null) memoryStore = null;
}
