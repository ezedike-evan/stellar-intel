CREATE TABLE IF NOT EXISTS settlement_status (
  anchor_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (anchor_id, transaction_id)
);
