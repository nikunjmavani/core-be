-- migration-safety: allow create_index_without_concurrently reason="migration runner wraps each migration in a transaction, so CREATE INDEX CONCURRENTLY cannot be used here; indexes are additive and support bounded keyset pagination paths"

-- Audit log keyset pagination, newest first by (created_at, id), with common filters.
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created_id
  ON audit.logs (organization_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_id
  ON audit.logs (actor_user_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_id
  ON audit.logs (created_at, id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_id
  ON audit.logs (action, created_at, id);

-- Tenant list keyset pagination, oldest first by stable tuple.
CREATE INDEX IF NOT EXISTS idx_organizations_created_id_active
  ON tenancy.organizations (created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_org_created_id_active
  ON tenancy.memberships (organization_id, created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_org_created_id_active
  ON tenancy.api_keys (organization_id, created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_roles_org_name_id_active
  ON tenancy.roles (organization_id, name, id)
  WHERE deleted_at IS NULL;

-- Admin user list, oldest first by stable tuple, restricted to active rows.
CREATE INDEX IF NOT EXISTS idx_users_created_id_active
  ON auth.users (created_at, id)
  WHERE deleted_at IS NULL;

-- Notification inbox keyset pagination, newest first per user.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_id
  ON notify.notifications (user_id, created_at, id);
