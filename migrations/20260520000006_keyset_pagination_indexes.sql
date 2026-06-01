-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY avoids the SHARE lock that blocks writes on high-write tables during the index build"
-- migration-safety: allow create_index_without_concurrently reason="audit.logs and notify.notifications are seeded empty by the consolidated baseline; these keyset indexes build instantly here and predate any production traffic"

-- Each statement is separated by `--> statement-breakpoint` so the runner sends
-- it to Postgres independently; CREATE INDEX CONCURRENTLY cannot share an
-- implicit transaction with another statement.
--
-- audit.logs and notify.notifications use a plain recursive CREATE INDEX: they
-- are created empty by the baseline migration, so the build is instantaneous and
-- precedes any live writes. Once large, add new indexes to them CONCURRENTLY.

-- Audit log keyset pagination, newest first by (created_at, id), with common filters.
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created_id
  ON audit.logs (organization_id, created_at, id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_id
  ON audit.logs (actor_user_id, created_at, id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_id
  ON audit.logs (created_at, id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_id
  ON audit.logs (action, created_at, id);
--> statement-breakpoint

-- Tenant list keyset pagination, oldest first by stable tuple.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_created_id_active
  ON tenancy.organizations (created_at, id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memberships_org_created_id_active
  ON tenancy.memberships (organization_id, created_at, id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_org_created_id_active
  ON tenancy.api_keys (organization_id, created_at, id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_roles_org_name_id_active
  ON tenancy.roles (organization_id, name, id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- Admin user list, oldest first by stable tuple, restricted to active rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_id_active
  ON auth.users (created_at, id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- Notification inbox keyset pagination, newest first per user.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_id
  ON notify.notifications (user_id, created_at, id);
