import { getSqlExecutor, hasDatabaseUrl } from '@/lib/reputation/pool';
import type { OutcomeDirection } from '@/types/reputation';

// ─── Refund case store ──────────────────────────────────────────────────────────
//
// A durable record of every refund Stellar Intel knows about: one the anchor already
// made, or one the anchor owes because it failed after the user paid. Stellar Intel is
// non-custodial (docs/NON_CUSTODY.md) and never pays a refund itself, so a case tracks
// the anchor's obligation and the user's signed acknowledgement, nothing more.
//
// Same shape as the dispute store: in-memory by default, Postgres when DATABASE_URL is
// set, with the DDL run inline once per process. Cases are never deleted, and the only
// change a case can take after it is opened is its acknowledgement.

export const REFUND_REASONS = [
  'anchor_refunded',
  'anchor_error_after_payment',
  'expired_after_payment',
  'slippage_breach',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_CASE_STATUSES = ['owed', 'refunded', 'acknowledged'] as const;
export type RefundCaseStatus = (typeof REFUND_CASE_STATUSES)[number];

export const REFUND_OWED_OVERDUE_MS = 7 * 24 * 60 * 60 * 1000;

export type RefundOnChainCheck = 'verified' | 'mismatch' | 'unverifiable';

export interface RefundPaymentRecord {
  id: string;
  idType: 'stellar' | 'external';
  amount: string;
  fee: string;
}

export interface RefundCase {
  id: string; // crypto.randomUUID()
  intentHash: string; // 64-char lowercase hex, the outcome row key
  reason: RefundReason;
  anchorId: string;
  corridor: string;
  direction: OutcomeDirection;
  signerAccount: string; // G… account that signed the outcome
  amountPaid: string; // decimal string
  status: RefundCaseStatus;
  amountRefunded: string | null;
  refundFee: string | null;
  payments: RefundPaymentRecord[];
  openedAt: string; // ISO 8601
  refundedAt: string | null;
  acknowledgedAt: string | null;
  ackHash: string | null;
  ackSignature: string | null;
  onChainCheck: RefundOnChainCheck | null;
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
  /** Moves an `owed` or `refunded` case to `acknowledged`; sets refundedAt to acknowledgedAt when it was null.
   *  Returns null when the id is unknown or the case is already acknowledged. */
  acknowledge(id: string, update: RefundAckUpdate): Promise<RefundCase | null>;
}

/** A deep copy, so callers never hold a reference into a store. */
function copy(record: RefundCase): RefundCase {
  return { ...record, payments: record.payments.map((p) => ({ ...p })) };
}

function openedAtMs(record: RefundCase): number {
  return new Date(record.openedAt).getTime();
}

function oldestFirst(a: RefundCase, b: RefundCase): number {
  return openedAtMs(a) - openedAtMs(b);
}

function newestFirst(a: RefundCase, b: RefundCase): number {
  return openedAtMs(b) - openedAtMs(a);
}

function matches(record: RefundCase, filter: RefundCaseFilter): boolean {
  if (filter.status !== undefined && record.status !== filter.status) return false;
  if (filter.anchorId !== undefined && record.anchorId !== filter.anchorId) return false;
  if (
    filter.openedSince !== undefined &&
    openedAtMs(record) < new Date(filter.openedSince).getTime()
  ) {
    return false;
  }
  return true;
}

export class InMemoryRefundStore implements RefundStore {
  private readonly cases = new Map<string, RefundCase>();

  async open(record: RefundCase): Promise<boolean> {
    for (const existing of this.cases.values()) {
      if (existing.intentHash === record.intentHash && existing.reason === record.reason) {
        return false;
      }
    }
    // Ids are random UUIDs; a repeat is a bug, refused as the Postgres primary key refuses it.
    if (this.cases.has(record.id)) throw new Error(`refund case ${record.id} already exists`);
    this.cases.set(record.id, copy(record));
    return true;
  }

  async get(id: string): Promise<RefundCase | null> {
    const found = this.cases.get(id);
    return found ? copy(found) : null;
  }

  async getByIntentHash(intentHash: string): Promise<RefundCase[]> {
    return Array.from(this.cases.values())
      .filter((c) => c.intentHash === intentHash)
      .sort(oldestFirst)
      .map(copy);
  }

  async list(filter: RefundCaseFilter = {}): Promise<RefundCase[]> {
    return Array.from(this.cases.values())
      .filter((c) => matches(c, filter))
      .sort(newestFirst)
      .map(copy);
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
    return copy(updated);
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS refund_cases (
    id              TEXT NOT NULL,
    intent_hash     TEXT NOT NULL,
    reason          TEXT NOT NULL,
    anchor_id       TEXT NOT NULL,
    corridor        TEXT NOT NULL,
    direction       TEXT NOT NULL,
    signer_account  TEXT NOT NULL,
    amount_paid     TEXT NOT NULL,
    status          TEXT NOT NULL,
    amount_refunded TEXT,
    refund_fee      TEXT,
    payments_json   TEXT NOT NULL DEFAULT '[]',
    opened_at       TEXT NOT NULL,
    refunded_at     TEXT,
    acknowledged_at TEXT,
    ack_hash        TEXT,
    ack_signature   TEXT,
    on_chain_check  TEXT,
    PRIMARY KEY (id),
    UNIQUE (intent_hash, reason)
  );
  CREATE INDEX IF NOT EXISTS refund_cases_opened_at_idx ON refund_cases (opened_at);
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

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

/** Parses the stored payments, falling back to none when the column is not a valid list. */
function parsePayments(value: unknown): RefundPaymentRecord[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as RefundPaymentRecord[]) : [];
  } catch {
    return [];
  }
}

/** Maps a `refund_cases` row to a RefundCase. */
export function toRefundCase(row: Record<string, unknown>): RefundCase {
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
    amountRefunded: nullableString(row['amount_refunded']),
    refundFee: nullableString(row['refund_fee']),
    payments: parsePayments(row['payments_json']),
    openedAt: String(row['opened_at']),
    refundedAt: nullableString(row['refunded_at']),
    acknowledgedAt: nullableString(row['acknowledged_at']),
    ackHash: nullableString(row['ack_hash']),
    ackSignature: nullableString(row['ack_signature']),
    onChainCheck: nullableString(row['on_chain_check']) as RefundOnChainCheck | null,
  };
}

export class PostgresRefundStore implements RefundStore {
  async open(record: RefundCase): Promise<boolean> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `INSERT INTO refund_cases
         (id, intent_hash, reason, anchor_id, corridor, direction, signer_account, amount_paid,
          status, amount_refunded, refund_fee, payments_json, opened_at, refunded_at,
          acknowledged_at, ack_hash, ack_signature, on_chain_check)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (intent_hash, reason) DO NOTHING
       RETURNING id`,
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
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await getSqlExecutor().query(
      `SELECT * FROM refund_cases${where} ORDER BY opened_at DESC`,
      params
    );
    return rows.map(toRefundCase);
  }

  async acknowledge(id: string, update: RefundAckUpdate): Promise<RefundCase | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `UPDATE refund_cases
       SET status = 'acknowledged', amount_refunded = $2, refund_fee = $3, payments_json = $4,
           ack_hash = $5, ack_signature = $6, acknowledged_at = $7, on_chain_check = $8,
           refunded_at = COALESCE(refunded_at, $7)
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
