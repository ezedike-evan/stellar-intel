import { getSqlExecutor, hasDatabaseUrl } from '@/lib/reputation/pool';
import { TERMINAL_STATES, getSep24Transaction } from '@/lib/stellar/sep24';
import { getSep6Transaction } from '@/lib/stellar/sep6';
import { emitWebhookEvent } from './emit';

export interface SettlementStatusKey {
  anchorId: string;
  transactionId: string;
}

export interface SettlementStatusStore {
  swap(key: SettlementStatusKey, status: string, observedAt: string): Promise<string | null>;
}

export class InMemorySettlementStatusStore implements SettlementStatusStore {
  private readonly table = new Map<string, { status: string; observedAt: string }>();

  async swap(key: SettlementStatusKey, status: string, observedAt: string): Promise<string | null> {
    const k = `${key.anchorId}:${key.transactionId}`;
    const previous = this.table.get(k);
    this.table.set(k, { status, observedAt });
    return previous?.status ?? null;
  }

  clear(): void {
    this.table.clear();
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS settlement_status (
    anchor_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    status TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (anchor_id, transaction_id)
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

export function _resetSettlementStatusSchema(): void {
  schemaReady = null;
}

export class PostgresSettlementStatusStore implements SettlementStatusStore {
  async swap(key: SettlementStatusKey, status: string, observedAt: string): Promise<string | null> {
    await ensureSchema();
    const sql = `
      WITH old AS (
        SELECT status FROM settlement_status
        WHERE anchor_id = $1 AND transaction_id = $2
      ),
      upsert AS (
        INSERT INTO settlement_status (anchor_id, transaction_id, status, observed_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (anchor_id, transaction_id)
        DO UPDATE SET status = EXCLUDED.status, observed_at = EXCLUDED.observed_at
      )
      SELECT status AS previous FROM old;
    `;
    const { rows } = await getSqlExecutor().query(sql, [
      key.anchorId,
      key.transactionId,
      status,
      observedAt,
    ]);
    return (rows[0]?.['previous'] as string | undefined) ?? null;
  }
}

let singleton: SettlementStatusStore | null = null;

export function getSettlementStatusStore(): SettlementStatusStore {
  if (!singleton) {
    singleton = hasDatabaseUrl()
      ? new PostgresSettlementStatusStore()
      : new InMemorySettlementStatusStore();
  }
  return singleton;
}

export function _setSettlementStatusStore(store: SettlementStatusStore | null): void {
  singleton = store;
}

export interface ObserveSettlementStatusParams {
  anchorId: string;
  transferServer: string;
  transactionId: string;
  protocol: 'sep24' | 'sep6';
  direction: 'withdraw' | 'deposit';
  intentHash?: string | undefined;
  jwt: string;
}

export interface ObservedSettlementStatus {
  status: string;
  previous: string | null;
  changed: boolean;
  terminal: boolean;
}

/** What `observeSettlementStatus` calls out to, injectable so tests need no network. */
export interface ObserveSettlementStatusDeps {
  /** Defaults to the real emitter. */
  emit?: typeof emitWebhookEvent;
}

/**
 * Re-reads the anchor's own transaction record server-side using the forwarded SEP-10 JWT,
 * records the status observation atomically, and reports whether the status has changed.
 *
 * Every observed change is announced as one `settlement.status_changed` webhook (WHK011).
 * A repeat of the status already recorded announces nothing. `intent.settled` and
 * `intent.failed` are not emitted here: they come from `/api/reputation/append` only.
 */
export async function observeSettlementStatus(
  params: ObserveSettlementStatusParams,
  deps: ObserveSettlementStatusDeps = {}
): Promise<ObservedSettlementStatus> {
  const { anchorId, transferServer, transactionId, protocol, jwt } = params;

  const tx =
    protocol === 'sep6'
      ? await getSep6Transaction(transferServer, transactionId, jwt)
      : await getSep24Transaction(transferServer, transactionId, jwt);

  const status = tx.status;
  const observedAt = new Date().toISOString();
  const store = getSettlementStatusStore();
  const previous = await store.swap({ anchorId, transactionId }, status, observedAt);
  const changed = previous !== status;
  const terminal = (TERMINAL_STATES as ReadonlySet<string>).has(status);

  if (changed) {
    const emit = deps.emit ?? emitWebhookEvent;
    emit(
      'settlement.status_changed',
      {
        anchorId,
        transactionId,
        protocol,
        direction: params.direction,
        from: previous,
        to: status,
        terminal,
        intentHash: params.intentHash ?? null,
        observedAt,
      },
      // The transaction and the status it moved to. Two observers that both see the
      // same change, on two instances, send the same key, and a subscriber sees one event.
      { idempotencyKey: `settlement.status_changed:${anchorId}:${transactionId}:${status}` }
    );
  }

  return { status, previous, changed, terminal };
}
