import { getSqlExecutor, hasDatabaseUrl } from '@/lib/reputation/pool';
import type { OutcomeDirection } from '@/types/reputation';

// ─── Refund case store ──────────────────────────────────────────────────────────
//
// Refund guarantees need a durable record of every refund Stellar Intel knows
// about: one the anchor already made, or one the anchor owes because it failed
// after the user paid. Stellar Intel is non-custodial (`docs/NON_CUSTODY.md`)
// — it never pays a refund itself — so this record tracks the anchor's
// obligation and the user's signed acknowledgement, nothing more.
//
// Same shape as the dispute store: in-memory by default, Postgres when
// DATABASE_URL is set, with the DDL run inline once per process because nothing
// applies lib/reputation/migrations/.

export const REFUND_REASONS = [
  'anchor_refunded',
  'anchor_error_after_payment',
  'expired_after_payment',
  'slippage_breach',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_CASE_STATUSES = ['owed', 'refunded', 'acknowledged'] as const;
export type RefundCaseStatus = (typeof REFUND_CASE_STATUSES)[number];

export type RefundOnChainCheck = 'verified' | 'mismatch' | 'unverifiable';

export interface RefundPaymentRecord {
  id: string;
  idType: 'stellar' | 'external';
  amount: string;
  fee: string;
}

export interface RefundCase {
  /** crypto.randomUUID() */
  id: string;
  /** 64-char lowercase hex, the outcome row key */
  intentHash: string;
  reason: RefundReason;
  anchorId: string;
  corridor: string;
  direction: OutcomeDirection;
  /** G… account that signed the outcome */
  signerAccount: string;
  /** decimal string */
  amountPaid: string;
  status: RefundCaseStatus;
  amountRefunded: string | null;
  refundFee: string | null;
  payments: RefundPaymentRecord[];
  /** ISO 8601 */
  openedAt: string;
  refundedAt: string | null;
  acknowledgedAt: string | null;
  ackHash: string | null;
  ackSignature: string | null;
  onChainCheck: RefundOnChainCheck | null;
}

export type PublicRefundCase = Omit<RefundCase, 'signerAccount' | 'ackSignature' | 'ackHash'>;

/**
 * Builds the public representation of a refund case field by field, never spreading,
 * ensuring sensitive credentials (signerAccount, ackSignature, ackHash) never leak.
 */
export function toPublicRefundCase(c: RefundCase): PublicRefundCase {
  return {
    id: c.id,
    intentHash: c.intentHash,
    reason: c.reason,
    anchorId: c.anchorId,
    corridor: c.corridor,
    direction: c.direction,
    amountPaid: c.amountPaid,
    status: c.status,
    amountRefunded: c.amountRefunded,
    refundFee: c.refundFee,
    payments: c.payments ? c.payments.map((p) => ({ ...p })) : [],
    openedAt: c.openedAt,
    refundedAt: c.refundedAt,
    acknowledgedAt: c.acknowledgedAt,
    onChainCheck: c.onChainCheck,
  };
}

export interface RefundCaseFilter {
  status?: RefundCaseStatus;
  anchorId?: string;
  openedSince?: string;
}

export interface RefundAckUpdate {
  amountRefunded: string;
  refundFee: string;
  payments: RefundPaymentRecord[];
  ackHash: string;
  ackSignature: string;
  acknowledgedAt: string;
  onChainCheck: RefundOnChainCheck | null;
}

export interface RefundStore {
  /** Insert-only. False when a case for the same (intentHash, reason) already exists. */
  open(record: RefundCase): Promise<boolean>;
  get(id: string): Promise<RefundCase | null>;
  /** Every case for an intent, oldest first. */
  getByIntentHash(intentHash: string): Promise<RefundCase[]>;
  /** Newest first (by openedAt). */
  list(filter?: RefundCaseFilter): Promise<RefundCase[]>;
  /**
   * Moves an `owed` or `refunded` case to `acknowledged`; sets refundedAt to
   * acknowledgedAt when it was null. Returns null when the id is unknown or
   * the case is already acknowledged.
   */
  acknowledge(id: string, update: RefundAckUpdate): Promise<RefundCase | null>;
}

function copyCase(record: RefundCase): RefundCase {
  return { ...record, payments: record.payments.map((p) => ({ ...p })) };
}

function newestFirst(a: RefundCase, b: RefundCase): number {
  return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime();
}

function oldestFirst(a: RefundCase, b: RefundCase): number {
  return new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime();
}

export class InMemoryRefundStore implements RefundStore {
  private readonly cases = new Map<string, RefundCase>();

  async open(record: RefundCase): Promise<boolean> {
    for (const existing of this.cases.values()) {
      if (existing.intentHash === record.intentHash && existing.reason === record.reason) {
        return false;
      }
    }
    this.cases.set(record.id, copyCase(record));
    return true;
  }

  async get(id: string): Promise<RefundCase | null> {
    const found = this.cases.get(id);
    return found ? copyCase(found) : null;
  }

  async getByIntentHash(intentHash: string): Promise<RefundCase[]> {
    return Array.from(this.cases.values())
      .filter((c) => c.intentHash === intentHash)
      .sort(oldestFirst)
      .map(copyCase);
  }

  async list(filter: RefundCaseFilter = {}): Promise<RefundCase[]> {
    return Array.from(this.cases.values())
      .filter(
        (c) =>
          (filter.status === undefined || c.status === filter.status) &&
          (filter.anchorId === undefined || c.anchorId === filter.anchorId) &&
          (filter.openedSince === undefined || c.openedAt >= filter.openedSince)
      )
      .sort(newestFirst)
      .map(copyCase);
  }

  async acknowledge(id: string, update: RefundAckUpdate): Promise<RefundCase | null> {
    const found = this.cases.get(id);
    if (!found || found.status === 'acknowledged') return null;
    const updated: RefundCase = {
      ...found,
      status: 'acknowledged',
      amountRefunded: update.amountRefunded,
      refundFee: update.refundFee,
      payments: update.payments.map((p) => ({ ...p })),
      ackHash: update.ackHash,
      ackSignature: update.ackSignature,
      acknowledgedAt: update.acknowledgedAt,
      refundedAt: found.refundedAt ?? update.acknowledgedAt,
      onChainCheck: update.onChainCheck,
    };
    this.cases.set(id, updated);
    return copyCase(updated);
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS refund_cases (
    id               TEXT PRIMARY KEY,
    intent_hash      TEXT NOT NULL,
    reason           TEXT NOT NULL,
    anchor_id        TEXT NOT NULL,
    corridor         TEXT NOT NULL,
    direction        TEXT NOT NULL,
    signer_account   TEXT NOT NULL,
    amount_paid      TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'owed',
    amount_refunded  TEXT,
    refund_fee       TEXT,
    payments_json    TEXT NOT NULL DEFAULT '[]',
    opened_at        TEXT NOT NULL,
    refunded_at      TEXT,
    acknowledged_at  TEXT,
    ack_hash         TEXT,
    ack_signature    TEXT,
    on_chain_check   TEXT,
    UNIQUE (intent_hash, reason)
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
export function _resetRefundSchema(): void {
  schemaReady = null;
}

function toRefundCase(row: Record<string, unknown>): RefundCase {
  let payments: RefundPaymentRecord[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row['payments_json'] ?? '[]'));
    if (Array.isArray(parsed)) payments = parsed as RefundPaymentRecord[];
  } catch {
    payments = [];
  }
  return {
    id: String(row['id']),
    intentHash: String(row['intent_hash']),
    reason: String(row['reason']) as RefundReason,
    anchorId: String(row['anchor_id']),
    corridor: String(row['corridor']),
    direction: String(row['direction']) as OutcomeDirection,
    signerAccount: String(row['signer_account']),
    amountPaid: String(row['amount_paid']),
    status: String(row['status']) as RefundCaseStatus,
    amountRefunded: row['amount_refunded'] == null ? null : String(row['amount_refunded']),
    refundFee: row['refund_fee'] == null ? null : String(row['refund_fee']),
    payments,
    openedAt: String(row['opened_at']),
    refundedAt: row['refunded_at'] == null ? null : String(row['refunded_at']),
    acknowledgedAt: row['acknowledged_at'] == null ? null : String(row['acknowledged_at']),
    ackHash: row['ack_hash'] == null ? null : String(row['ack_hash']),
    ackSignature: row['ack_signature'] == null ? null : String(row['ack_signature']),
    onChainCheck:
      row['on_chain_check'] == null ? null : (String(row['on_chain_check']) as RefundOnChainCheck),
  };
}

export class PostgresRefundStore implements RefundStore {
  async open(record: RefundCase): Promise<boolean> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `INSERT INTO refund_cases
         (id, intent_hash, reason, anchor_id, corridor, direction, signer_account,
          amount_paid, status, amount_refunded, refund_fee, payments_json, opened_at,
          refunded_at, acknowledged_at, ack_hash, ack_signature, on_chain_check)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (intent_hash, reason) DO NOTHING RETURNING id`,
      [
        record.id,
        record.intentHash,
        record.reason,
        record.anchorId,
        record.corridor,
        record.direction,
        record.signerAccount,
        record.amountPaid,
        record.status,
        record.amountRefunded,
        record.refundFee,
        JSON.stringify(record.payments),
        record.openedAt,
        record.refundedAt,
        record.acknowledgedAt,
        record.ackHash,
        record.ackSignature,
        record.onChainCheck,
      ]
    );
    return rows.length > 0;
  }

  async get(id: string): Promise<RefundCase | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query('SELECT * FROM refund_cases WHERE id = $1', [id]);
    return rows[0] ? toRefundCase(rows[0]) : null;
  }

  async getByIntentHash(intentHash: string): Promise<RefundCase[]> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      'SELECT * FROM refund_cases WHERE intent_hash = $1 ORDER BY opened_at ASC',
      [intentHash]
    );
    return rows.map(toRefundCase);
  }

  async list(filter: RefundCaseFilter = {}): Promise<RefundCase[]> {
    await ensureSchema();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status !== undefined) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.anchorId !== undefined) {
      params.push(filter.anchorId);
      conditions.push(`anchor_id = $${params.length}`);
    }
    if (filter.openedSince !== undefined) {
      params.push(filter.openedSince);
      conditions.push(`opened_at >= $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await getSqlExecutor().query(
      `SELECT * FROM refund_cases ${where} ORDER BY opened_at DESC`,
      params
    );
    return rows.map(toRefundCase);
  }

  async acknowledge(id: string, update: RefundAckUpdate): Promise<RefundCase | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `UPDATE refund_cases
          SET status = 'acknowledged',
              amount_refunded = $2,
              refund_fee = $3,
              payments_json = $4,
              ack_hash = $5,
              ack_signature = $6,
              acknowledged_at = $7,
              refunded_at = COALESCE(refunded_at, $7),
              on_chain_check = $8
        WHERE id = $1 AND status <> 'acknowledged'
      RETURNING *`,
      [
        id,
        update.amountRefunded,
        update.refundFee,
        JSON.stringify(update.payments),
        update.ackHash,
        update.ackSignature,
        update.acknowledgedAt,
        update.onChainCheck,
      ]
    );
    return rows[0] ? toRefundCase(rows[0]) : null;
  }
}

let override: RefundStore | null = null;
let memoryStore: InMemoryRefundStore | null = null;
let postgresStore: PostgresRefundStore | null = null;

/** Postgres when `DATABASE_URL` is set, otherwise a per-process in-memory store. */
export function getRefundStore(): RefundStore {
  if (override) return override;
  if (hasDatabaseUrl()) return (postgresStore ??= new PostgresRefundStore());
  return (memoryStore ??= new InMemoryRefundStore());
}

/** Test seam: pin a store, or pass null to drop the pin and the in-memory state. */
export function _setRefundStore(store: RefundStore | null): void {
  override = store;
  if (store === null) memoryStore = null;
}
