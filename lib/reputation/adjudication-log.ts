import crypto from 'node:crypto';
import {
  DISPUTE_CATEGORIES,
  DISPUTE_LEVELS,
  type DisputeCategory,
  type DisputeLevel,
} from './dispute-ladder';
import { getSqlExecutor, hasDatabaseUrl } from './pool';

export const ADJUDICATION_ACTIONS = [
  'filed',
  'escalated',
  'accepted',
  'rejected',
  'appealed',
] as const;

export type AdjudicationAction = (typeof ADJUDICATION_ACTIONS)[number];

export const GENESIS_HASH = '0'.repeat(64);
export const RATIONALE_MAX = 500;

export interface AdjudicationEntryInput {
  disputeRef: string;
  anchorId: string;
  category: DisputeCategory;
  level: DisputeLevel;
  action: AdjudicationAction;
  rationale: string;
  decidedAt: string;
}

export interface AdjudicationEntry extends AdjudicationEntryInput {
  seq: number;
  prevHash: string;
  entryHash: string;
}

export function publicDisputeRef(disputeId: string): string {
  return crypto.createHash('sha256').update(disputeId).digest('hex').slice(0, 16);
}

export class PublicTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicTextError';
  }
}

export class AdjudicationLogConflictError extends Error {
  constructor(message: string = 'Adjudication log append conflicted after maximum retries') {
    super(message);
    this.name = 'AdjudicationLogConflictError';
  }
}

export function assertPublicSafe(text: string): void {
  if (text.length > RATIONALE_MAX) {
    throw new PublicTextError(`Rationale exceeds maximum length of ${RATIONALE_MAX} characters`);
  }
  if (/G[A-Z0-9]{55}/i.test(text)) {
    throw new PublicTextError('Rationale contains a Stellar public key, which cannot be published');
  }
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) {
    throw new PublicTextError('Rationale contains an email address, which cannot be published');
  }
  if (/\d{9,}/.test(text)) {
    throw new PublicTextError('Rationale contains an account or phone number (9+ digits)');
  }
}

export function computeEntryHash(entry: Omit<AdjudicationEntry, 'entryHash'>): string {
  const payload = {
    action: entry.action,
    anchorId: entry.anchorId,
    category: entry.category,
    decidedAt: entry.decidedAt,
    disputeRef: entry.disputeRef,
    level: entry.level,
    prevHash: entry.prevHash,
    rationale: entry.rationale,
    seq: entry.seq,
  };
  const canonical = 'stellar-intel/adjudication/v1\n' + JSON.stringify(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export type ChainVerification =
  | { ok: true; length: number; head: string }
  | {
      ok: false;
      brokenAtSeq: number;
      reason: 'seq_gap' | 'prev_hash_mismatch' | 'entry_hash_mismatch';
    };

export function verifyChain(entries: readonly AdjudicationEntry[]): ChainVerification {
  if (entries.length === 0) {
    return { ok: true, length: 0, head: GENESIS_HASH };
  }

  let expectedPrevHash = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const expectedSeq = i + 1;
    if (entry.seq !== expectedSeq) {
      return { ok: false, brokenAtSeq: entry.seq, reason: 'seq_gap' };
    }
    if (entry.prevHash !== expectedPrevHash) {
      return { ok: false, brokenAtSeq: entry.seq, reason: 'prev_hash_mismatch' };
    }
    const computed = computeEntryHash(entry);
    if (computed !== entry.entryHash) {
      return { ok: false, brokenAtSeq: entry.seq, reason: 'entry_hash_mismatch' };
    }
    expectedPrevHash = entry.entryHash;
  }

  return { ok: true, length: entries.length, head: expectedPrevHash };
}

export interface AdjudicationLogStore {
  append(input: AdjudicationEntryInput): Promise<AdjudicationEntry>;
  list(opts?: { afterSeq?: number; limit?: number }): Promise<AdjudicationEntry[]>;
  head(): Promise<AdjudicationEntry | null>;
}

function validateInput(input: AdjudicationEntryInput): void {
  assertPublicSafe(input.rationale);
  if (!ADJUDICATION_ACTIONS.includes(input.action)) {
    throw new TypeError(`Invalid adjudication action: ${input.action}`);
  }
  if (!DISPUTE_LEVELS.includes(input.level)) {
    throw new TypeError(`Invalid dispute level: ${input.level}`);
  }
  if (!DISPUTE_CATEGORIES.includes(input.category)) {
    throw new TypeError(`Invalid dispute category: ${input.category}`);
  }
}

export class InMemoryAdjudicationLog implements AdjudicationLogStore {
  private readonly entries: AdjudicationEntry[] = [];

  async append(input: AdjudicationEntryInput): Promise<AdjudicationEntry> {
    validateInput(input);
    const last = this.entries[this.entries.length - 1];
    const seq = last ? last.seq + 1 : 1;
    const prevHash = last ? last.entryHash : GENESIS_HASH;
    const entryHash = computeEntryHash({ ...input, seq, prevHash });
    const record: AdjudicationEntry = {
      ...input,
      seq,
      prevHash,
      entryHash,
    };
    this.entries.push({ ...record });
    return { ...record };
  }

  async list(opts?: { afterSeq?: number; limit?: number }): Promise<AdjudicationEntry[]> {
    let result = this.entries;
    if (opts?.afterSeq !== undefined) {
      const after = opts.afterSeq;
      result = result.filter((e) => e.seq > after);
    }
    if (opts?.limit !== undefined) {
      result = result.slice(0, opts.limit);
    }
    return result.map((e) => ({ ...e }));
  }

  async head(): Promise<AdjudicationEntry | null> {
    const last = this.entries[this.entries.length - 1];
    return last ? { ...last } : null;
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS adjudication_log (
    seq         INTEGER PRIMARY KEY,
    dispute_ref TEXT NOT NULL,
    anchor_id   TEXT NOT NULL,
    category    TEXT NOT NULL,
    level       TEXT NOT NULL,
    action      TEXT NOT NULL,
    rationale   TEXT NOT NULL,
    decided_at  TEXT NOT NULL,
    prev_hash   TEXT NOT NULL,
    entry_hash  TEXT NOT NULL UNIQUE
  );
`;

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getSqlExecutor()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err: unknown) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

export function _resetAdjudicationSchema(): void {
  schemaReady = null;
}

function toEntry(row: Record<string, unknown>): AdjudicationEntry {
  return {
    seq: Number(row['seq']),
    disputeRef: String(row['dispute_ref']),
    anchorId: String(row['anchor_id']),
    category: String(row['category']) as DisputeCategory,
    level: String(row['level']) as DisputeLevel,
    action: String(row['action']) as AdjudicationAction,
    rationale: String(row['rationale']),
    decidedAt: String(row['decided_at']),
    prevHash: String(row['prev_hash']),
    entryHash: String(row['entry_hash']),
  };
}

export class PostgresAdjudicationLog implements AdjudicationLogStore {
  async append(input: AdjudicationEntryInput): Promise<AdjudicationEntry> {
    validateInput(input);
    await ensureSchema();

    for (let attempt = 0; attempt < 3; attempt++) {
      const currentHead = await this.head();
      const seq = currentHead ? currentHead.seq + 1 : 1;
      const prevHash = currentHead ? currentHead.entryHash : GENESIS_HASH;
      const entryHash = computeEntryHash({ ...input, seq, prevHash });

      const res = await getSqlExecutor().query(
        `INSERT INTO adjudication_log
           (seq, dispute_ref, anchor_id, category, level, action, rationale, decided_at, prev_hash, entry_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (seq) DO NOTHING
         RETURNING seq`,
        [
          seq,
          input.disputeRef,
          input.anchorId,
          input.category,
          input.level,
          input.action,
          input.rationale,
          input.decidedAt,
          prevHash,
          entryHash,
        ]
      );

      if (res.rows.length > 0) {
        return {
          ...input,
          seq,
          prevHash,
          entryHash,
        };
      }
    }

    throw new AdjudicationLogConflictError();
  }

  async list(opts?: { afterSeq?: number; limit?: number }): Promise<AdjudicationEntry[]> {
    await ensureSchema();
    const afterSeq = opts?.afterSeq ?? 0;
    const limit = opts?.limit ?? 1000;
    const { rows } = await getSqlExecutor().query(
      `SELECT * FROM adjudication_log WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
      [afterSeq, limit]
    );
    return rows.map(toEntry);
  }

  async head(): Promise<AdjudicationEntry | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `SELECT * FROM adjudication_log ORDER BY seq DESC LIMIT 1`
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }
}

let override: AdjudicationLogStore | null = null;
let memoryStore: InMemoryAdjudicationLog | null = null;
let postgresStore: PostgresAdjudicationLog | null = null;

export function getAdjudicationLog(): AdjudicationLogStore {
  if (override) return override;
  if (hasDatabaseUrl()) return (postgresStore ??= new PostgresAdjudicationLog());
  return (memoryStore ??= new InMemoryAdjudicationLog());
}

export function _setAdjudicationLog(store: AdjudicationLogStore | null): void {
  override = store;
  if (store === null) memoryStore = null;
}
