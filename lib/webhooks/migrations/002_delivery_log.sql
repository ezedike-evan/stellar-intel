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
