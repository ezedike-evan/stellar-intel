import { getSqlExecutor, hasDatabaseUrl } from '@/lib/reputation/pool';
import { type DisputeCategory, type DisputeLevel, levelDeadline } from './dispute-ladder';

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

export type DisputeSubjectKind = 'outcome' | 'refund' | 'slippage_breach';

export interface Dispute {
  id: string;
  intentHash: string;
  publicKey: string;
  anchorId: string;
  reason: string;
  status: DisputeStatus;
  createdAt: string;
  resolvedAt: string | null;
  category: DisputeCategory;
  level: DisputeLevel;
  levelDeadline: string;
  subjectKind: DisputeSubjectKind;
  subjectRef: string | null;
  appealedAt: string | null;
}

export interface DisputeStore {
  create(record: Dispute): Promise<void>;
  /** Every dispute, newest first. */
  list(): Promise<Dispute[]>;
  get(id: string): Promise<Dispute | null>;
  /** Resolves a dispute; null when the id is unknown or already resolved. */
  resolve(id: string, status: 'accepted' | 'rejected', resolvedAt: string): Promise<Dispute | null>;
  /** Escalates a dispute to the given level; null when id unknown or not open. */
  escalate(id: string, level: DisputeLevel, levelDeadline: string): Promise<Dispute | null>;
  /** Finds all disputes for an intent hash, newest first. */
  findByIntentHash(intentHash: string): Promise<Dispute[]>;
  /** Finds all disputes for a given subject kind and reference, newest first. */
  findBySubject(kind: DisputeSubjectKind, ref: string): Promise<Dispute[]>;
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

  async escalate(id: string, level: DisputeLevel, levelDeadline: string): Promise<Dispute | null> {
    const found = this.disputes.get(id);
    if (!found || found.status !== 'open') return null;
    const updated: Dispute = { ...found, level, levelDeadline };
    this.disputes.set(id, updated);
    return { ...updated };
  }

  async findByIntentHash(intentHash: string): Promise<Dispute[]> {
    return Array.from(this.disputes.values())
      .filter((d) => d.intentHash === intentHash)
      .sort(newestFirst)
      .map((d) => ({ ...d }));
  }

  async findBySubject(kind: DisputeSubjectKind, ref: string): Promise<Dispute[]> {
    return Array.from(this.disputes.values())
      .filter((d) => d.subjectKind === kind && d.subjectRef === ref)
      .sort(newestFirst)
      .map((d) => ({ ...d }));
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS disputes (
    id             TEXT PRIMARY KEY,
    intent_hash    TEXT NOT NULL,
    public_key     TEXT NOT NULL,
    anchor_id      TEXT NOT NULL,
    reason         TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'open',
    created_at     TEXT NOT NULL,
    resolved_at    TEXT,
    category       TEXT NOT NULL DEFAULT 'other',
    level          TEXT NOT NULL DEFAULT 'review',
    level_deadline TEXT,
    subject_kind   TEXT NOT NULL DEFAULT 'outcome',
    subject_ref    TEXT,
    appealed_at    TEXT
  );
  ALTER TABLE disputes ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';
  ALTER TABLE disputes ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'review';
  ALTER TABLE disputes ADD COLUMN IF NOT EXISTS level_deadline TEXT;
  ALTER TABLE disputes ADD COLUMN IF NOT EXISTS subject_kind TEXT NOT NULL DEFAULT 'outcome';
  ALTER TABLE disputes ADD COLUMN IF NOT EXISTS subject_ref TEXT;
  ALTER TABLE disputes ADD COLUMN IF NOT EXISTS appealed_at TEXT;
  CREATE INDEX IF NOT EXISTS disputes_intent_hash_idx ON disputes (intent_hash);
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
  const createdAt = String(row['created_at']);
  const category = (row['category'] as DisputeCategory) ?? 'other';
  const level = (row['level'] as DisputeLevel) ?? 'review';
  const intentHash = String(row['intent_hash']);
  const subjectKind = (row['subject_kind'] as DisputeSubjectKind) ?? 'outcome';
  const subjectRef =
    row['subject_ref'] == null
      ? subjectKind === 'outcome'
        ? intentHash
        : null
      : String(row['subject_ref']);
  const levelDeadlineStr =
    row['level_deadline'] == null ? levelDeadline(level, createdAt) : String(row['level_deadline']);

  return {
    id: String(row['id']),
    intentHash,
    publicKey: String(row['public_key']),
    anchorId: String(row['anchor_id']),
    reason: String(row['reason']),
    status: String(row['status']) as DisputeStatus,
    createdAt,
    resolvedAt: row['resolved_at'] == null ? null : String(row['resolved_at']),
    category,
    level,
    levelDeadline: levelDeadlineStr,
    subjectKind,
    subjectRef,
    appealedAt: row['appealed_at'] == null ? null : String(row['appealed_at']),
  };
}

export class PostgresDisputeStore implements DisputeStore {
  async create(record: Dispute): Promise<void> {
    await ensureSchema();
    await getSqlExecutor().query(
      `INSERT INTO disputes
         (id, intent_hash, public_key, anchor_id, reason, status, created_at, resolved_at,
          category, level, level_deadline, subject_kind, subject_ref, appealed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        record.id,
        record.intentHash,
        record.publicKey,
        record.anchorId,
        record.reason,
        record.status,
        record.createdAt,
        record.resolvedAt,
        record.category,
        record.level,
        record.levelDeadline,
        record.subjectKind,
        record.subjectRef,
        record.appealedAt,
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

  async escalate(id: string, level: DisputeLevel, levelDeadline: string): Promise<Dispute | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      'UPDATE disputes SET level = $2, level_deadline = $3 WHERE id = $1 AND status = $4 RETURNING *',
      [id, level, levelDeadline, 'open']
    );
    return rows[0] ? toDispute(rows[0]) : null;
  }

  async findByIntentHash(intentHash: string): Promise<Dispute[]> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      'SELECT * FROM disputes WHERE intent_hash = $1 ORDER BY created_at DESC',
      [intentHash]
    );
    return rows.map(toDispute);
  }

  async findBySubject(kind: DisputeSubjectKind, ref: string): Promise<Dispute[]> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      'SELECT * FROM disputes WHERE subject_kind = $1 AND subject_ref = $2 ORDER BY created_at DESC',
      [kind, ref]
    );
    return rows.map(toDispute);
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
