-- Add dispute columns to outcome_log (Issue #164)
ALTER TABLE outcome_log
  ADD COLUMN IF NOT EXISTS disputed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS disputed_reason TEXT;
