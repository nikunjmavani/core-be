-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- sec-new-B4: unique index for auth.auth_methods.public_id — must run in a separate
-- non-transactional migration because CONCURRENTLY is not allowed inside a transaction block.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_methods_public_id
  ON auth.auth_methods(public_id);
