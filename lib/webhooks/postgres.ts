import { getSqlExecutor } from '@/lib/reputation/pool';
import type { DeliveryQuery, WebhookStore } from './store';
import type {
  DeliveryRecord,
  DeliveryStatus,
  WebhookEvent,
  WebhookEventKind,
  WebhookSubscription,
} from './types';

// ─── Durable webhook store (Issue #1337) ───────────────────────────────────────
//
// The in-memory store is per-instance: on serverless a subscription created on
// one instance does not exist on another, and it vanishes on cold start.
//
// The DDL is copied from migrations/001_subscriptions.sql, 002_delivery_log.sql,
// 003_events.sql and 004_delivery_log_subscription_index.sql and run inline,
// because nothing applies those files.
// Same approach as lib/api/shared-state.ts.

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id          TEXT        PRIMARY KEY,
    url         TEXT        NOT NULL,
    secret      TEXT        NOT NULL,
    events      TEXT        NOT NULL, -- JSON array of WebhookEventKind strings
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_created_at
    ON webhook_subscriptions (created_at DESC);

  CREATE TABLE IF NOT EXISTS webhook_delivery_log (
    id                TEXT        PRIMARY KEY,
    event_id          TEXT        NOT NULL,
    event_kind        TEXT        NOT NULL,
    subscription_id   TEXT        NOT NULL,
    url               TEXT        NOT NULL,
    status            TEXT        NOT NULL CHECK (status IN ('success', 'failed', 'dead_letter')),
    attempts          INT         NOT NULL DEFAULT 1,
    last_status_code  INT,
    last_error        TEXT,
    delivered_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_event_id
    ON webhook_delivery_log (event_id);

  CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_status
    ON webhook_delivery_log (status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_subscription
    ON webhook_delivery_log (subscription_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS webhook_events (
    id               TEXT        PRIMARY KEY,
    idempotency_key  TEXT        NOT NULL UNIQUE,
    kind             TEXT        NOT NULL,
    body             TEXT        NOT NULL, -- JSON envelope, exactly as dispatched
    created_at       TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at
    ON webhook_events (created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

/** Creates both tables once per process. */
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
export function _resetWebhookSchema(): void {
  schemaReady = null;
}

// pg returns TIMESTAMPTZ columns as Date objects; the types promise ISO strings.
function toIso(value: unknown): string {
  return new Date(value as string).toISOString();
}

function rowToSubscription(r: Record<string, unknown>): WebhookSubscription {
  return {
    id: r['id'] as string,
    url: r['url'] as string,
    secret: r['secret'] as string,
    events: JSON.parse(r['events'] as string) as WebhookEventKind[],
    createdAt: toIso(r['created_at']),
  };
}

function rowToDelivery(r: Record<string, unknown>): DeliveryRecord {
  return {
    id: r['id'] as string,
    eventId: r['event_id'] as string,
    eventKind: r['event_kind'] as WebhookEventKind,
    subscriptionId: r['subscription_id'] as string,
    url: r['url'] as string,
    status: r['status'] as DeliveryStatus,
    attempts: Number(r['attempts']),
    lastStatusCode: r['last_status_code'] == null ? null : Number(r['last_status_code']),
    lastError: (r['last_error'] as string | null) ?? null,
    deliveredAt: r['delivered_at'] == null ? null : toIso(r['delivered_at']),
    createdAt: toIso(r['created_at']),
  };
}

export class PostgresWebhookStore implements WebhookStore {
  async recordEvent(event: WebhookEvent): Promise<boolean> {
    await ensureSchema();
    // The unique idempotency key makes the insert the dedupe check: a repeat inserts nothing
    // and RETURNING gives no row (SqlExecutor only exposes `rows`, not rowCount).
    const { rows } = await getSqlExecutor().query(
      `INSERT INTO webhook_events (id, idempotency_key, kind, body, created_at)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [event.id, event.idempotencyKey, event.kind, JSON.stringify(event), event.createdAt]
    );
    return rows.length > 0;
  }

  async getEvent(id: string): Promise<WebhookEvent | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(`SELECT body FROM webhook_events WHERE id = $1`, [
      id,
    ]);
    const row = rows[0];
    return row ? (JSON.parse(row['body'] as string) as WebhookEvent) : null;
  }

  async saveSubscription(sub: WebhookSubscription): Promise<void> {
    await ensureSchema();
    // Upsert, matching the in-memory store's Map.set.
    await getSqlExecutor().query(
      `INSERT INTO webhook_subscriptions (id, url, secret, events, created_at)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
             SET url = EXCLUDED.url,
                 secret = EXCLUDED.secret,
                 events = EXCLUDED.events,
                 created_at = EXCLUDED.created_at`,
      [sub.id, sub.url, sub.secret, JSON.stringify(sub.events), sub.createdAt]
    );
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `SELECT id, url, secret, events, created_at
         FROM webhook_subscriptions
        ORDER BY created_at ASC`
    );
    return rows.map(rowToSubscription);
  }

  async getSubscription(id: string): Promise<WebhookSubscription | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `SELECT id, url, secret, events, created_at FROM webhook_subscriptions WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    return row ? rowToSubscription(row) : null;
  }

  async deleteSubscription(id: string): Promise<boolean> {
    await ensureSchema();
    // RETURNING rather than rowCount: SqlExecutor only exposes `rows`.
    const { rows } = await getSqlExecutor().query(
      `DELETE FROM webhook_subscriptions WHERE id = $1 RETURNING id`,
      [id]
    );
    return rows.length > 0;
  }

  async recordDelivery(record: DeliveryRecord): Promise<void> {
    await ensureSchema();
    await getSqlExecutor().query(
      `INSERT INTO webhook_delivery_log (
         id, event_id, event_kind, subscription_id, url, status, attempts,
         last_status_code, last_error, delivered_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.id,
        record.eventId,
        record.eventKind,
        record.subscriptionId,
        record.url,
        record.status,
        record.attempts,
        record.lastStatusCode,
        record.lastError,
        record.deliveredAt,
        record.createdAt,
      ]
    );
  }

  async listDeadLetters(): Promise<DeliveryRecord[]> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `SELECT id, event_id, event_kind, subscription_id, url, status, attempts,
              last_status_code, last_error, delivered_at, created_at
         FROM webhook_delivery_log
        WHERE status = 'dead_letter'
        ORDER BY created_at DESC
        LIMIT 500`
    );
    return rows.map(rowToDelivery);
  }

  async listDeliveries(query: DeliveryQuery): Promise<DeliveryRecord[]> {
    await ensureSchema();
    const rawLimit = query.limit ?? 100;
    const limit = Math.max(1, Math.min(500, rawLimit));

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.status !== undefined) {
      params.push(query.status);
      clauses.push(`status = $${params.length}`);
    }
    if (query.subscriptionId !== undefined) {
      params.push(query.subscriptionId);
      clauses.push(`subscription_id = $${params.length}`);
    }
    if (query.eventId !== undefined) {
      params.push(query.eventId);
      clauses.push(`event_id = $${params.length}`);
    }

    params.push(limit);
    const limitParamIndex = params.length;

    const whereClause = clauses.length > 0 ? `\n        WHERE ${clauses.join(' AND ')}` : '';

    const sql = `SELECT id, event_id, event_kind, subscription_id, url, status, attempts,
              last_status_code, last_error, delivered_at, created_at
         FROM webhook_delivery_log${whereClause}
        ORDER BY created_at DESC
        LIMIT $${limitParamIndex}`;

    const { rows } = await getSqlExecutor().query(sql, params);
    return rows.map(rowToDelivery);
  }
}
