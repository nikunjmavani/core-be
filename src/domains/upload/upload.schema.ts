import { sql } from 'drizzle-orm';
import {
  bigserial,
  bigint,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { uploadSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';

export const uploads = uploadSchema
  .table(
    'uploads',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      public_id: varchar('public_id', { length: 21 }).notNull(),
      user_id: bigint('user_id', { mode: 'number' })
        .notNull()
        .references(() => users.id),
      organization_id: bigint('organization_id', { mode: 'number' }).references(
        () => organizations.id,
      ),
      file_name: varchar('file_name', { length: 255 }).notNull(),
      file_key: varchar('file_key', { length: 512 }).notNull(),
      mime_type: varchar('mime_type', { length: 100 }).notNull(),
      file_size: integer('file_size').notNull(),
      storage_provider: varchar('storage_provider', { length: 20 }).notNull().default('s3'),
      bucket: varchar('bucket', { length: 100 }).notNull(),
      status: varchar('status', { length: 20 }).notNull().default('PENDING'),
      metadata: jsonb('metadata').notNull().default({}),
      uploaded_at: timestamp('uploaded_at', { withTimezone: true }),
      deleted_at: timestamp('deleted_at', { withTimezone: true }),
      created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      created_by_user_id: bigint('created_by_user_id', { mode: 'number' }).references(
        () => users.id,
      ),
    },
    (table) => [
      uniqueIndex('idx_uploads_public_id').on(table.public_id),
      index('idx_uploads_user_id').on(table.user_id),
      index('idx_uploads_organization_id')
        .on(table.organization_id)
        .where(sql`${table.organization_id} IS NOT NULL`),
      index('idx_uploads_pending_created_at')
        .on(table.created_at)
        .where(sql`${table.status} = 'PENDING' AND ${table.deleted_at} IS NULL`),
      check('chk_uploads_file_size', sql`${table.file_size} >= 0`),
      check('chk_uploads_status', sql`${table.status} IN ('PENDING', 'UPLOADED', 'FAILED')`),
      pgPolicy('uploads_tenant_isolation', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: sql`(
            ${table.organization_id} IS NOT NULL
            AND ${table.organization_id} = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true'`,
      }),
      // Owner access for user-scoped (NULL-org) uploads such as avatars. Permissive → OR'd with
      // the tenant-isolation policy, so org-scoped access is unchanged; inert until a context
      // sets app.current_user_id (withUserDatabaseContext).
      pgPolicy('uploads_owner_access', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: sql`${table.user_id} = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )`,
      }),
    ],
  )
  .enableRLS();
