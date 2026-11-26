-- Mirrors SCHEMA_SQL in lib/recurring/postgres.ts
CREATE TABLE IF NOT EXISTS recurring_authorizations (
  id            TEXT        PRIMARY KEY,
  terms_hash    TEXT        NOT NULL UNIQUE,
  sender        TEXT        NOT NULL,
  authorization TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_executions (
  id                TEXT        PRIMARY KEY,
  authorization_id  TEXT        NOT NULL,
  cycle_number      INT         NOT NULL,
  period_index      INT         NOT NULL,
  amount            TEXT        NOT NULL,
  anchor_id         TEXT        NOT NULL,
  intent_hash       TEXT        NOT NULL,
  transaction_id    TEXT,
  status            TEXT        NOT NULL CHECK (status IN ('confirmed', 'rejected')),
  reject_code       TEXT,
  created_at        TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_exec_confirmed
  ON recurring_executions (authorization_id, cycle_number)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_recurring_executions_lookup
  ON recurring_executions (authorization_id, cycle_number, created_at);
