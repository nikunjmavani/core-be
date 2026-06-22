-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- prod-hardening (SQL scalability review): index every attribution FK column.
--
-- The created_by_user_id / updated_by_user_id / invited_by_user_id columns carry
-- FK constraints to auth.users(id) but had no covering index on ANY of these 14
-- tables. When a user is hard-deleted (GDPR offboarding — the purge behind
-- users.deleted_at), Postgres must validate every referencing FK; with no index
-- on the referencing column it sequentially scans the entire child table once per
-- FK, so a single user delete fans out into N full-table scans and holds locks
-- for the duration — a cost that grows linearly as each table fills. The same
-- index also serves "rows created/updated/invited by user X" admin & audit reads.
--
-- Most attribution columns are NULL for the bulk of rows (system-created records),
-- so each index is PARTIAL on `IS NOT NULL` to stay tiny; the sole NOT NULL column
-- (member_invitations.invited_by_user_id) gets a full index. Mirrors the audit.logs
-- actor-FK indexing already in place. CONCURRENTLY keeps the build online (no table
-- lock); IF NOT EXISTS makes the migration safe to re-run. Generated from live
-- pg_attribute introspection (every *_by_user_id column lacking a leading index).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_methods_created_by_user_id
  ON auth.auth_methods (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mfa_methods_created_by_user_id
  ON auth.mfa_methods (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_preferences_created_by_user_id
  ON auth.user_notification_preferences (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_preferences_updated_by_user_id
  ON auth.user_notification_preferences (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_created_by_user_id
  ON billing.plans (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_updated_by_user_id
  ON billing.plans (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_created_by_user_id
  ON billing.subscriptions (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_updated_by_user_id
  ON billing.subscriptions (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_created_by_user_id
  ON notify.webhooks (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_updated_by_user_id
  ON notify.webhooks (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_created_by_user_id
  ON tenancy.api_keys (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_updated_by_user_id
  ON tenancy.api_keys (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_invitations_created_by_user_id
  ON tenancy.member_invitations (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_invitations_invited_by_user_id
  ON tenancy.member_invitations (invited_by_user_id);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memberships_created_by_user_id
  ON tenancy.memberships (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memberships_invited_by_user_id
  ON tenancy.memberships (invited_by_user_id)
  WHERE invited_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memberships_updated_by_user_id
  ON tenancy.memberships (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_notification_policies_created_by_user_id
  ON tenancy.organization_notification_policies (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_notification_policies_updated_by_user_id
  ON tenancy.organization_notification_policies (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_settings_created_by_user_id
  ON tenancy.organization_settings (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_settings_updated_by_user_id
  ON tenancy.organization_settings (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_created_by_user_id
  ON tenancy.organizations (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_updated_by_user_id
  ON tenancy.organizations (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_permissions_created_by_user_id
  ON tenancy.role_permissions (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_roles_created_by_user_id
  ON tenancy.roles (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_roles_updated_by_user_id
  ON tenancy.roles (updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_uploads_created_by_user_id
  ON upload.uploads (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
