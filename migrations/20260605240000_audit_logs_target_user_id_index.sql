-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- sec-D3: `audit.logs.target_user_id` has FK ON DELETE SET NULL to auth.users
-- but no supporting index. User tombstone-retention's hard-delete forces a
-- seq scan over `audit.logs` for the FK cascade. Combined with sec-D2's 5s
-- per-worker statement timeout, retention silently never completes once the
-- audit table is large.
--
-- Partial index on the non-null subset (most rows have target_user_id NULL
-- for non-user-targeted events) — keeps index small while still answering
-- the FK-cascade scan and any "audit by target user" lookup.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_target_user_id
  ON audit.logs (target_user_id)
  WHERE target_user_id IS NOT NULL;
