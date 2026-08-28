-- Track when/where a row's outcome was mirrored to the Soroban reputation
-- oracle (packages/publisher). Distinct from reconciled_at, which marks
-- off-chain delivery confirmation via Horizon.
ALTER TABLE outcome_log
  ADD COLUMN IF NOT EXISTS published_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oracle_tx_hash TEXT;
