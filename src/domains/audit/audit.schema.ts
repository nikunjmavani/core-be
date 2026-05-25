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

export const logs = auditSchema
  .table(
    'logs',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      actor_user_id: bigint('actor_user_id', { mode: 'number' }).references(() => users.id, {
        onDelete: 'set null',
      }),
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
          OR current_setting('app.global_retention_cleanup', true) = 'true'`,
      }),
    ],
  )
  .enableRLS();

export type AuditLogInsert = typeof logs.$inferInsert;
