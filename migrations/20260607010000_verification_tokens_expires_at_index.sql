-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- sec-D #11: the sec-D5 retention sweep deletes verification tokens past expiry
-- via batched `DELETE FROM auth.verification_tokens WHERE expires_at < cutoff`,
-- but no index covered the predicate. Each batch fell back to a seq scan,
-- so as auth volume grows the sweep cost grows quadratically in batches and
-- eventually hits the worker statement timeout — at which point plaintext
-- `email` + `token_hash` would be retained beyond the GDPR grace window the
-- sweep was supposed to enforce.
--
-- Idempotent: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` is safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_verification_tokens_expires_at
  ON auth.verification_tokens (expires_at);
