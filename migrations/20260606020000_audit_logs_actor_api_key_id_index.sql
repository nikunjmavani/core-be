-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- sec-D8: `audit.logs.actor_api_key_id` has FK ON DELETE SET NULL to
-- `tenancy.api_keys` (sec-D8 was filed against the sec-D3 sibling fix). API
-- keys are soft-deleted today, so the cascade-scan does not fire — but the
-- "audit by api-key" admin query is still O(N) seq scan and a future hard-
-- delete path would inherit the same per-worker-timeout retention hang that
-- sec-D3 fixed for `target_user_id`.
--
-- Partial index on the non-null subset (api-key actors are a small minority of
-- rows; most actions are performed by users, so the predicate keeps the index
-- small) WITH a `created_at` tail so the existing "audit feed by actor, newest
-- first" pagination is covered without an extra index.
--
-- Idempotent: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` is safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_actor_api_key_id_created
  ON audit.logs (actor_api_key_id, created_at)
  WHERE actor_api_key_id IS NOT NULL;
