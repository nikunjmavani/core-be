-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- sec-new-B2: unique index for notify.webhook_delivery_attempts.public_id
-- (column added in 20260608020000_webhook_delivery_attempts_add_public_id.sql).
-- Enforces uniqueness of the public identifier used as the X-Webhook-Delivery-Id
-- outbound header value.
--
-- Idempotent: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS` is safe to re-run.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_delivery_attempts_public_id
  ON notify.webhook_delivery_attempts(public_id);
