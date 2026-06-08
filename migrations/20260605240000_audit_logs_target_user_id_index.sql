-- migration-transaction: none reason="Keep this single audit.logs index outside a transaction alongside other non-transactional index migrations"
-- migration-safety: allow create_index_without_concurrently reason="audit.logs uses the same plain-index exception as 20260520000006; local/CI migrations apply from an empty or test-sized baseline, and postgres.js rejects the CONCURRENTLY form for this audit.logs migration before IF NOT EXISTS can skip an already-built index"
-- sec-D3: `audit.logs.target_user_id` has FK ON DELETE SET NULL to auth.users
-- but no supporting index. User tombstone-retention's hard-delete forces a
-- seq scan over `audit.logs` for the FK cascade. Combined with sec-D2's 5s
-- per-worker statement timeout, retention silently never completes once the
-- audit table is large.
--
-- Partial index on the non-null subset (most rows have target_user_id NULL
-- for non-user-targeted events) — keeps index small while still answering
-- the FK-cascade scan and any "audit by target user" lookup.

CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_id
  ON audit.logs (target_user_id)
  WHERE target_user_id IS NOT NULL;
