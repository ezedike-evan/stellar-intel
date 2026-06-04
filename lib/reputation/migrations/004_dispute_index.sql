-- Add disputed column to settlement events table
ALTER TABLE settlement_events ADD COLUMN IF NOT EXISTS disputed BOOLEAN NOT NULL DEFAULT FALSE;

-- Create partial index skipping disputed rows for aggregation queries
CREATE INDEX IF NOT EXISTS idx_settlement_events_not_disputed
  ON settlement_events (anchor_id, corridor, completed_at DESC)
  WHERE disputed = FALSE;
