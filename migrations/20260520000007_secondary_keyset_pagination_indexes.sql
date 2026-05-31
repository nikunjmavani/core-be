-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY avoids the SHARE lock that blocks writes during the index build"

-- Each statement is separated by `--> statement-breakpoint` so the runner sends
-- it to Postgres independently; CREATE INDEX CONCURRENTLY cannot share an
-- implicit transaction with another statement.

-- Notify webhook lists, oldest first by stable tuple within an organization.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_org_created_id_active
  ON notify.webhooks (organization_id, created_at, id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- Webhook delivery attempts, newest first by stable tuple within a webhook.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_attempts_webhook_created_id
  ON notify.webhook_delivery_attempts (webhook_id, created_at, id);
--> statement-breakpoint

-- Member invitation lists, oldest first by stable tuple.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_invitations_membership_created_id
  ON tenancy.member_invitations (membership_id, created_at, id);
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_invitations_created_id
  ON tenancy.member_invitations (created_at, id);
