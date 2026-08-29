CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id          TEXT        PRIMARY KEY,
  url         TEXT        NOT NULL,
  secret      TEXT        NOT NULL,
  events      TEXT        NOT NULL, -- JSON array of WebhookEventKind strings
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_created_at
  ON webhook_subscriptions (created_at DESC);
