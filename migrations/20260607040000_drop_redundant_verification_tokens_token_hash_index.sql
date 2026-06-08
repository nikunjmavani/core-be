-- migration-transaction: none reason="DROP INDEX CONCURRENTLY cannot run in a transaction"
-- sec-D #32: `auth.verification_tokens.token_hash` is declared `UNIQUE` at the
-- column level (`CONSTRAINT verification_tokens_token_hash_unique UNIQUE
-- ("token_hash")` in the baseline migration) — that already provisions a
-- unique btree index covering every query against the column. The separate
-- non-unique `idx_verification_tokens_token_hash` on the same column is dead
-- duplicate index work: doubled write amplification on every token insert
-- (one row per magic-link / password-reset / email-verify attempt) and a
-- wasted ~33% of the page cache for the table, but zero read benefit because
-- the planner prefers the unique index for equality lookups.
--
-- Idempotent: `DROP INDEX CONCURRENTLY IF EXISTS` is safe to re-run.

DROP INDEX CONCURRENTLY IF EXISTS auth.idx_verification_tokens_token_hash;
