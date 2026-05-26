-- migration-safety: allow create_index_without_concurrently reason="migration runner wraps each migration in a transaction, so CREATE INDEX CONCURRENTLY cannot be used here; indexes are additive and support bounded keyset pagination paths"

-- Notify webhook lists, oldest first by stable tuple within an organization.
CREATE INDEX IF NOT EXISTS idx_webhooks_org_created_id_active
  ON notify.webhooks (organization_id, created_at, id)
  WHERE deleted_at IS NULL;

-- Webhook delivery attempts, newest first by stable tuple within a webhook.
CREATE INDEX IF NOT EXISTS idx_webhook_attempts_webhook_created_id
  ON notify.webhook_delivery_attempts (webhook_id, created_at, id);

-- Member invitation lists, oldest first by stable tuple.
CREATE INDEX IF NOT EXISTS idx_member_invitations_membership_created_id
  ON tenancy.member_invitations (membership_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_member_invitations_created_id
  ON tenancy.member_invitations (created_at, id);
