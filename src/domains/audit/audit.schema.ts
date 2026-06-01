import { sql } from 'drizzle-orm';
import {
  bigserial,
  bigint,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  check,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { auditSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { api_keys } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.schema.js';

/**
 * Drizzle definition for `audit.logs` — the append-only ledger of actor/resource
 * actions. RLS tenant-isolation policy scopes rows to the current organization
 * (or to retention-cleanup workers that set `app.global_retention_cleanup`, or
 * the cross-tenant admin escape hatch `app.global_admin` used by the admin
 * audit-log listing via `withGlobalAdminDatabaseContext`).
 */
export const logs = auditSchema
  .table(
    'logs',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      actor_user_id: bigint('actor_user_id', { mode: 'number' }).references(() => users.id, {
        onDelete: 'set null',
      }),
      // Set instead of actor_user_id when the action was performed by an organization API key
      // (which has no acting user). Nullable + ON DELETE SET NULL like actor_user_id; the app
      // guarantees at least one of the two actor columns is set at write time.
      actor_api_key_id: bigint('actor_api_key_id', { mode: 'number' }).references(
        () => api_keys.id,
        { onDelete: 'set null' },
      ),
      target_user_id: bigint('target_user_id', { mode: 'number' }).references(() => users.id, {
        onDelete: 'set null',
      }),
      organization_id: bigint('organization_id', { mode: 'number' }).references(
        () => organizations.id,
        { onDelete: 'set null' },
      ),
      action: varchar('action', { length: 100 }).notNull(),
      resource_type: varchar('resource_type', { length: 50 }).notNull(),
      resource_id: bigint('resource_id', { mode: 'number' }),
      ip_address: varchar('ip_address', { length: 45 }),
      user_agent: text('user_agent'),
      severity: varchar('severity', { length: 20 }).notNull().default('INFO'),
      metadata: jsonb('metadata').notNull().default({}),
      created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index('idx_audit_logs_org_created').on(table.organization_id, table.created_at),
      index('idx_audit_logs_org_created_id').on(table.organization_id, table.created_at, table.id),
      index('idx_audit_logs_actor_created').on(table.actor_user_id, table.created_at),
      index('idx_audit_logs_actor_created_id').on(table.actor_user_id, table.created_at, table.id),
      index('idx_audit_logs_resource').on(table.resource_type, table.resource_id, table.created_at),
      index('idx_audit_logs_created_at').on(table.created_at),
      index('idx_audit_logs_created_id').on(table.created_at, table.id),
      index('idx_audit_logs_severity_created').on(table.severity, table.created_at),
      index('idx_audit_logs_action_created').on(table.action, table.created_at),
      index('idx_audit_logs_action_created_id').on(table.action, table.created_at, table.id),
      check(
        'chk_audit_severity',
        sql`${table.severity} IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')`,
      ),
      pgPolicy('audit_logs_tenant_isolation', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: sql`${table.organization_id} = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true'
          OR current_setting('app.global_admin', true) = 'true'`,
      }),
      pgPolicy('audit_logs_user_export_select', {
        as: 'permissive',
        for: 'select',
        to: 'public',
        using: sql`${table.actor_user_id} = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )`,
      }),
    ],
  )
  .enableRLS();

/** Drizzle-inferred insert row shape for {@link logs}. */
export type AuditLogInsert = typeof logs.$inferInsert;
