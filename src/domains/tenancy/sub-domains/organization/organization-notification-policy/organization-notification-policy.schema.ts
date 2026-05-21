import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { tenancySchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';

export const organization_notification_policies = tenancySchema
  .table(
    'organization_notification_policies',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      public_id: varchar('public_id', { length: 21 }).notNull(),
      organization_id: bigint('organization_id', { mode: 'number' })
        .notNull()
        .references(() => organizations.id, { onDelete: 'cascade' }),
      notification_type: varchar('notification_type', { length: 50 }).notNull(),
      channel: varchar('channel', { length: 20 }).notNull(),
      default_enabled: boolean('default_enabled').notNull().default(true),
      is_mandatory: boolean('is_mandatory').notNull().default(false),
      muted_until: timestamp('muted_until', { withTimezone: true }),
      deleted_at: timestamp('deleted_at', { withTimezone: true }),
      created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      created_by_user_id: bigint('created_by_user_id', { mode: 'number' }).references(
        () => users.id,
      ),
      updated_by_user_id: bigint('updated_by_user_id', { mode: 'number' }).references(
        () => users.id,
      ),
    },
    (table) => [
      uniqueIndex('idx_organization_notification_policies_public_id').on(table.public_id),
      uniqueIndex('idx_org_notif_policy_unique').on(
        table.organization_id,
        table.notification_type,
        table.channel,
      ),
      index('idx_org_notif_policy_mandatory').on(table.organization_id, table.is_mandatory),
      index('idx_org_notif_policy_muted').on(table.muted_until),
      check('chk_org_notif_channel', sql`${table.channel} IN ('EMAIL', 'SMS', 'PUSH', 'IN_APP')`),
      check(
        'chk_org_notif_muted',
        sql`${table.muted_until} IS NULL OR ${table.muted_until} > now()`,
      ),
      check('chk_org_notif_updated', sql`${table.updated_at} >= ${table.created_at}`),
      pgPolicy('organization_notification_policies_tenant_isolation', {
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
