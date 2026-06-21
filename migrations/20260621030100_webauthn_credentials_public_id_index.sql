-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- audit R5b / M3: unique index for auth.webauthn_credentials.public_id — must run in a separate
-- non-transactional migration because CONCURRENTLY is not allowed inside a transaction block.
-- The column was added + backfilled + SET NOT NULL in 20260621030000 (mirrors the auth_methods split).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS webauthn_credentials_public_id_unique
  ON auth.webauthn_credentials (public_id);
