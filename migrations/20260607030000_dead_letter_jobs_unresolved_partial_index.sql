-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- sec-Q #31 (aka sec-D #31): the DLQ auto-retry sweep filters
-- `WHERE auto_retry_resolved_at IS NULL AND failed_at < cutoff` (added by
-- 20260603140000), but the only matching index was
-- `idx_dead_letter_jobs_source_queue_failed_at` — a FULL index that returns
-- already-resolved rows mixed with unresolved ones. The planner walks the
-- resolved tail in vain on every tick until the audit-retention sweep prunes
-- them; per-tick cost grows with backlog and ultimately drives the sweeper
-- into the DLQ-depth threshold for the wrong reason (sweeper saturating the
-- pool, not real backlog).
--
-- Partial index keeps the working set small (resolved rows are the vast
-- majority post-budget-exhaustion) and orders by `failed_at` so the
-- existing oldest-first scan keeps its sequential read pattern.
--
-- Idempotent: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` is safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dead_letter_jobs_unresolved_source_failed_at
  ON audit.dead_letter_jobs (source_queue, failed_at)
  WHERE auto_retry_resolved_at IS NULL;
