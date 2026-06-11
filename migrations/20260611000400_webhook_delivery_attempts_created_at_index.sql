-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- audit-#3: support the new time-based retention sweep of notify.webhook_delivery_attempts.
-- Every existing index on the table leads with webhook_id or status, so a
-- `DELETE ... WHERE created_at < cutoff` batch sweep had no supporting index and would
-- scan. Add a plain btree on created_at so the daily retention worker prunes old rows
-- efficiently. Idempotent via IF NOT EXISTS.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_attempts_created_at
  ON notify.webhook_delivery_attempts (created_at);
