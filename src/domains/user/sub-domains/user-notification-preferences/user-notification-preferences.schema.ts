import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  varchar,
  boolean,
  timestamp,
  index,
  check,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';

export const user_notification_preferences = authSchema
  .table(
    'user_notification_preferences',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      user_id: bigint('user_id', { mode: 'number' })
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      organization_id: bigint('organization_id', { mode: 'number' }).references(
        () => organizations.id,
        { onDelete: 'set null' },
      ),
      notification_type: varchar('notification_type', { length: 50 }).notNull(),
      channel: varchar('channel', { length: 20 }).notNull(),
      is_enabled: boolean('is_enabled').notNull().default(true),
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
      index('idx_user_notif_prefs_user_type').on(
        table.user_id,
        table.notification_type,
        table.channel,
      ),
      index('idx_user_notif_prefs_org').on(table.organization_id, table.notification_type),
      check(
        'chk_user_notif_prefs_channel',
        sql`${table.channel} IN ('EMAIL', 'SMS', 'PUSH', 'IN_APP')`,
      ),
      check('chk_user_notif_prefs_updated', sql`${table.updated_at} >= ${table.created_at}`),
      pgPolicy('user_notification_preferences_user_org_access', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: sql`${table.user_id} = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )
          AND (
            ${table.organization_id} IS NULL
            OR ${table.organization_id} = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )`,
        withCheck: sql`${table.user_id} = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )
          AND (
            ${table.organization_id} IS NULL
            OR ${table.organization_id} = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )`,
      }),
    ],
  )
  .enableRLS();
