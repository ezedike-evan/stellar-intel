-- Persist the append route's signature check on each outcome row. `attested`
-- is TRUE only when POST /api/reputation/append verified an Ed25519 signature
-- by `signer_account` over `intent_hash`. Scoring, aggregation and the oracle
-- publisher read attested rows only, so rows written before this migration
-- (all unsigned) default to FALSE and drop out of scores until re-attested.
--
-- The Postgres and SQLite drivers apply the same change inline at startup
-- (lib/reputation/postgres.ts, lib/reputation/sqlite.ts); this file records it.
ALTER TABLE outcome_log
  ADD COLUMN IF NOT EXISTS attested       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS signer_account TEXT;

