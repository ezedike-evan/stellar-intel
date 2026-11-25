-- Every dispatched webhook event, stored once by its idempotency key (WHK004).
-- A repeat of the same key inserts nothing, so it is never delivered twice, and the stored
-- envelope lets a dead-lettered delivery be replayed by event id.
CREATE TABLE IF NOT EXISTS webhook_events (
  id               TEXT        PRIMARY KEY,
  idempotency_key  TEXT        NOT NULL UNIQUE,
  kind             TEXT        NOT NULL,
  body             TEXT        NOT NULL, -- JSON envelope, exactly as dispatched
  created_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at
  ON webhook_events (created_at DESC);
