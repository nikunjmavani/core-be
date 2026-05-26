import { sql } from 'drizzle-orm';
import {
  bigserial,
  bigint,
  jsonb,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  check,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { tenancySchema } from '@/infrastructure/database/pg-schemas.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { users } from '@/domains/user/user.schema.js';

export const api_keys = tenancySchema
  .table(
    'api_keys',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      public_id: varchar('public_id', { length: 21 }).notNull(),
      organization_id: bigint('organization_id', { mode: 'number' })
        .notNull()
        .references(() => organizations.id, { onDelete: 'cascade' }),
      name: varchar('name', { length: 255 }).notNull(),
      key_hash: varchar('key_hash', { length: 255 }).notNull(),
      key_prefix: varchar('key_prefix', { length: 10 }).notNull(),
      scopes: jsonb('scopes').notNull().default([]),
      last_used_at: timestamp('last_used_at', { withTimezone: true }),
      expires_at: timestamp('expires_at', { withTimezone: true }),
      status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
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
      uniqueIndex('idx_api_keys_public_id').on(table.public_id),
      index('idx_api_keys_organization').on(table.organization_id),
      index('idx_api_keys_organization_status').on(table.organization_id, table.status),
      index('idx_api_keys_org_created_id_active')
        .on(table.organization_id, table.created_at, table.id)
        .where(sql`${table.deleted_at} IS NULL`),
      index('idx_api_keys_key_prefix').on(table.key_prefix),
      index('idx_api_keys_deleted').on(table.deleted_at).where(sql`${table.deleted_at} IS NULL`),
      index('idx_api_keys_scopes_gin').using('gin', table.scopes),
      check('chk_api_keys_status', sql`${table.status} IN ('ACTIVE', 'REVOKED')`),
      check('chk_api_keys_updated', sql`${table.updated_at} >= ${table.created_at}`),
      pgPolicy('api_keys_tenant_isolation', {
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
