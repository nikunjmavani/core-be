-- migration-transaction: none reason="DROP INDEX CONCURRENTLY cannot run in a transaction"
-- sec-D #34: `idx_org_notif_policy_muted ON (muted_until)` was useful when
-- `muted_until` could carry arbitrary past or future timestamps. sec-D1
-- (20260605240100_drop_volatile_chk_org_notif_muted.sql) collapsed the
-- semantics: writers now normalize any stale `muted_until` back to NULL at
-- persistence time, so the column only ever holds NULL or a future
-- timestamp. There is no live read path that filters by `muted_until`
-- (consumers check `is_currently_muted` via a different code path), and a
-- btree over a column dominated by NULLs is pure dead weight: write
-- amplification on every policy upsert and pages occupied with index tuples
-- for rows the planner will never visit.
--
-- Idempotent: `DROP INDEX CONCURRENTLY IF EXISTS` is safe to re-run.

DROP INDEX CONCURRENTLY IF EXISTS tenancy.idx_org_notif_policy_muted;
