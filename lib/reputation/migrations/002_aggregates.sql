-- Rolling window aggregate table for anchor reputation scores
CREATE TABLE IF NOT EXISTS reputation_aggregates (
  id               BIGSERIAL    PRIMARY KEY,
  anchor_id        TEXT         NOT NULL,
  bucket_start     TIMESTAMPTZ  NOT NULL,
  window_days      INT          NOT NULL CHECK (window_days IN (7, 30, 90)),
  tx_count         INT          NOT NULL DEFAULT 0,
  success_count    INT          NOT NULL DEFAULT 0,
  avg_settlement_ms BIGINT,
  p50_settlement_ms BIGINT,
  p95_settlement_ms BIGINT,
  composite_score  NUMERIC(5,2),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (anchor_id, bucket_start, window_days)
);

CREATE INDEX IF NOT EXISTS idx_reputation_aggregates_anchor_bucket
  ON reputation_aggregates (anchor_id, bucket_start);

CREATE INDEX IF NOT EXISTS idx_reputation_aggregates_window
  ON reputation_aggregates (anchor_id, window_days, bucket_start DESC);