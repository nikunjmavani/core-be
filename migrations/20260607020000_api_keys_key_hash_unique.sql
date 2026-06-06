-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- sec-D #18: `tenancy.api_keys.key_hash` is the authentication credential
-- (SHA-256 of the raw API key). The table indexed `key_prefix` only — no
-- UNIQUE on `key_hash` itself. SHA-256 collisions across honestly-generated
-- keys are negligible, but a bug elsewhere (test fixture hard-coding the
-- hash, a future raw-import script, a copy-paste of the public-id collision-
-- retry pattern) could insert a duplicate hash; the auth resolver constant-
-- time-compares each prefix-bucketed candidate's hash and would authenticate
-- the FIRST match — possibly belonging to a different organization than the
-- one that issued the surviving key.
--
-- Partial UNIQUE on ACTIVE non-deleted rows so revoked-key reuse (the
-- legitimate rotate-then-revoke flow that may briefly hold two equal hashes
-- in different status states) is unaffected.
--
-- Idempotent: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS` is safe to re-run.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_key_hash_active_unique
  ON tenancy.api_keys (key_hash)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;
