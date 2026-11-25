import { getSqlExecutor, hasDatabaseUrl } from '@/lib/reputation/pool';
import { canonicalEvidenceJson } from '@/lib/reputation/slippage-evidence';

import {
  SLIPPAGE_BREACH_STATUSES,
  type SlippageBreach,
  type SlippageBreachStatus,
  type SlippageEvidence,
  type SlippageOnChainEvidence,
} from '@/types/reputation';

// The breach and evidence types live in types/reputation.ts (#2104); re-exported
// here so existing imports from this module keep working.
export { SLIPPAGE_BREACH_STATUSES };
export type { SlippageBreach, SlippageBreachStatus, SlippageEvidence, SlippageOnChainEvidence };

// ─── Slippage breach store (Issue #2103) ──────────────────────────────────────

export interface SlippageBreachFilter {
  anchorId?: string;
  status?: SlippageBreachStatus;
  since?: string;
  limit?: number;
}

export interface SlippageBreachStore {
  /**
   * Records a detected breach. Insert-only on `intentHash`.
   * Returns false if the breach record already exists.
   */
  create(record: SlippageBreach): Promise<boolean>;

  /** Retrieves a breach by its intent hash. */
  get(intentHash: string): Promise<SlippageBreach | null>;

  /**
   * Lists breaches matching the filter, ordered newest detectedAt first.
   * `limit` defaults to 100 in the store when omitted.
   */
  list(filter?: SlippageBreachFilter): Promise<SlippageBreach[]>;

  /**
   * Transitions a breach from 'detected' to 'verified' or 'rejected'.
   * Returns null if the breach does not exist or has already been resolved.
   */
  resolveVerification(
    intentHash: string,
    update: {
      status: 'verified' | 'rejected';
      evidence: SlippageEvidence;
      evidenceHash: string;
      rejectionReason: string | null;
      verifiedAt: string;
    }
  ): Promise<SlippageBreach | null>;
}

function newestFirst(a: SlippageBreach, b: SlippageBreach): number {
  return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
}

export class InMemorySlippageBreachStore implements SlippageBreachStore {
  private readonly breaches = new Map<string, SlippageBreach>();

  async create(record: SlippageBreach): Promise<boolean> {
    if (this.breaches.has(record.intentHash)) {
      return false;
    }
    this.breaches.set(record.intentHash, {
      ...record,
      evidence: JSON.parse(canonicalEvidenceJson(record.evidence)),
    });
    return true;
  }

  async get(intentHash: string): Promise<SlippageBreach | null> {
    const found = this.breaches.get(intentHash);
    return found
      ? {
          ...found,
          evidence: JSON.parse(canonicalEvidenceJson(found.evidence)),
        }
      : null;
  }

  async list(filter?: SlippageBreachFilter): Promise<SlippageBreach[]> {
    let rows = Array.from(this.breaches.values(), (b) => ({
      ...b,
      evidence: JSON.parse(canonicalEvidenceJson(b.evidence)),
    }));
    if (filter?.anchorId) {
      rows = rows.filter((b) => b.anchorId === filter.anchorId);
    }
    if (filter?.status) {
      rows = rows.filter((b) => b.status === filter.status);
    }
    if (filter?.since) {
      rows = rows.filter((b) => b.detectedAt >= filter.since!);
    }
    rows.sort(newestFirst);
    const limit = filter?.limit ?? 100;
    return rows.slice(0, limit);
  }

  async resolveVerification(
    intentHash: string,
    update: {
      status: 'verified' | 'rejected';
      evidence: SlippageEvidence;
      evidenceHash: string;
      rejectionReason: string | null;
      verifiedAt: string;
    }
  ): Promise<SlippageBreach | null> {
    const found = this.breaches.get(intentHash);
    if (!found || found.status !== 'detected') {
      return null;
    }
    const updated: SlippageBreach = {
      ...found,
      status: update.status,
      evidence: JSON.parse(canonicalEvidenceJson(update.evidence)),
      evidenceHash: update.evidenceHash,
      rejectionReason: update.rejectionReason,
      verifiedAt: update.verifiedAt,
    };
    this.breaches.set(intentHash, updated);
    return {
      ...updated,
      evidence: JSON.parse(canonicalEvidenceJson(updated.evidence)),
    };
  }
}

// ─── Postgres Slippage Breach Store ──────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS slippage_breaches (
  intent_hash TEXT PRIMARY KEY,
  anchor_id TEXT NOT NULL,
  corridor TEXT NOT NULL,
  signer_account TEXT NOT NULL,
  min_receive TEXT NOT NULL,
  amount_out TEXT NOT NULL,
  shortfall TEXT NOT NULL,
  shortfall_bps INTEGER NOT NULL,
  stellar_transaction_id TEXT,
  anchor_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'detected',
  rejection_reason TEXT,
  evidence TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_slippage_breaches_anchor ON slippage_breaches (anchor_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_slippage_breaches_status ON slippage_breaches (status);
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

function toSlippageBreach(row: Record<string, unknown>): SlippageBreach {
  return {
    intentHash: String(row.intent_hash),
    anchorId: String(row.anchor_id),
    corridor: String(row.corridor),
    signerAccount: String(row.signer_account),
    minReceive: String(row.min_receive),
    amountOut: String(row.amount_out),
    shortfall: String(row.shortfall),
    shortfallBps: Number(row.shortfall_bps),
    stellarTransactionId: row.stellar_transaction_id ? String(row.stellar_transaction_id) : null,
    anchorTransactionId: row.anchor_transaction_id ? String(row.anchor_transaction_id) : null,
    status: row.status as SlippageBreachStatus,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    evidence: JSON.parse(String(row.evidence)),
    evidenceHash: String(row.evidence_hash),
    detectedAt: String(row.detected_at),
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
  };
}

export class PostgresSlippageBreachStore implements SlippageBreachStore {
  async create(record: SlippageBreach): Promise<boolean> {
    await ensureSchema();
    const res = await getSqlExecutor().query(
      `INSERT INTO slippage_breaches
         (intent_hash, anchor_id, corridor, signer_account, min_receive, amount_out, shortfall, shortfall_bps, stellar_transaction_id, anchor_transaction_id, status, rejection_reason, evidence, evidence_hash, detected_at, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (intent_hash) DO NOTHING
       RETURNING intent_hash`,
      [
        record.intentHash,
        record.anchorId,
        record.corridor,
        record.signerAccount,
        record.minReceive,
        record.amountOut,
        record.shortfall,
        record.shortfallBps,
        record.stellarTransactionId,
        record.anchorTransactionId,
        record.status,
        record.rejectionReason,
        canonicalEvidenceJson(record.evidence),
        record.evidenceHash,
        record.detectedAt,
        record.verifiedAt,
      ]
    );
    return (res.rows?.length ?? 0) > 0;
  }

  async get(intentHash: string): Promise<SlippageBreach | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      'SELECT * FROM slippage_breaches WHERE intent_hash = $1',
      [intentHash]
    );
    return rows[0] ? toSlippageBreach(rows[0]) : null;
  }

  async list(filter?: SlippageBreachFilter): Promise<SlippageBreach[]> {
    await ensureSchema();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.anchorId) {
      params.push(filter.anchorId);
      conditions.push(`anchor_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter?.since) {
      params.push(filter.since);
      conditions.push(`detected_at >= $${params.length}`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 100;
    params.push(limit);
    const limitClause = `LIMIT $${params.length}`;
    const { rows } = await getSqlExecutor().query(
      `SELECT * FROM slippage_breaches ${whereClause} ORDER BY detected_at DESC ${limitClause}`,
      params
    );
    return rows.map(toSlippageBreach);
  }

  async resolveVerification(
    intentHash: string,
    update: {
      status: 'verified' | 'rejected';
      evidence: SlippageEvidence;
      evidenceHash: string;
      rejectionReason: string | null;
      verifiedAt: string;
    }
  ): Promise<SlippageBreach | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `UPDATE slippage_breaches
       SET status = $2, evidence = $3, evidence_hash = $4, rejection_reason = $5, verified_at = $6
       WHERE intent_hash = $1 AND status = 'detected'
       RETURNING *`,
      [
        intentHash,
        update.status,
        canonicalEvidenceJson(update.evidence),
        update.evidenceHash,
        update.rejectionReason,
        update.verifiedAt,
      ]
    );
    return rows[0] ? toSlippageBreach(rows[0]) : null;
  }
}

// ─── Singleton & Test Seams ───────────────────────────────────────────────────

let memoryStore: InMemorySlippageBreachStore | null = null;
let postgresStore: PostgresSlippageBreachStore | null = null;
let override: SlippageBreachStore | null = null;

/**
 * Returns the active SlippageBreachStore:
 * - A test override if set via `_setSlippageBreachStore`
 * - PostgresStore if DATABASE_URL is set
 * - InMemorySlippageBreachStore otherwise
 */
export function getSlippageBreachStore(): SlippageBreachStore {
  if (override) return override;
  if (hasDatabaseUrl()) return (postgresStore ??= new PostgresSlippageBreachStore());
  return (memoryStore ??= new InMemorySlippageBreachStore());
}

/** Test seam: override the store or clear memory store when null. */
export function _setSlippageBreachStore(store: SlippageBreachStore | null): void {
  override = store;
  if (store === null) memoryStore = null;
}

/** Test seam: reset all store state and schemas. */
export function _resetSlippageBreachStore(): void {
  override = null;
  memoryStore = null;
  postgresStore = null;
  schemaReady = null;
}

/** Test seam: reset schema initialization state. */
export function _resetSlippageBreachSchema(): void {
  schemaReady = null;
}
