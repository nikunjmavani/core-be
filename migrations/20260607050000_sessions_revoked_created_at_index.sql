-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- sec-D #33: the session cleanup worker deletes via
-- `WHERE expires_at < now OR (is_revoked = true AND created_at < cutoff)`.
-- The first branch is covered by `idx_sessions_expires`. The second branch —
-- bounded retention of revoked sessions — has no covering index: the
-- existing `idx_sessions_user_status (user_id, is_revoked, expires_at)` is
-- user-leading and `expires_at`-tailed, so it cannot satisfy a scan keyed on
-- `created_at`. As revoked sessions accumulate (mass-revoke campaigns, MFA
-- enrollment churn, sec-A7 step-up triggered revocations) the
-- `AND(is_revoked, created_at < cutoff)` branch falls back to a bitmap or
-- seq scan that eventually approaches `DATABASE_WORKER_STATEMENT_TIMEOUT_MS`.
--
-- Partial index scoped to revoked rows keeps the working set bounded to the
-- retention-eligible subset; the live (non-revoked) population is unaffected.
--
-- Idempotent: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` is safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_revoked_created_at
  ON auth.sessions (created_at)
  WHERE is_revoked = true;
