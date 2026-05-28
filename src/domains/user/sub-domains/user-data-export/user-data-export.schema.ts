import { sql } from 'drizzle-orm';
import { bigserial, varchar, timestamp, bigint, index, check } from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';

/**
 * `auth.user_data_exports` — one row per GDPR export request. Tracks job status, the S3 artifact key,
 * and the artifact `expires_at` timestamp used by the retention worker to purge the bucket alongside
 * S3 lifecycle rules. Cascades on user delete so offboarding cannot leave orphan exports.
 */
export const user_data_exports = authSchema.table(
  'user_data_exports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    public_id: varchar('public_id', { length: 21 }).notNull().unique(),
    user_id: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    s3_key: varchar('s3_key', { length: 512 }),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    failed_at: timestamp('failed_at', { withTimezone: true }),
    error_code: varchar('error_code', { length: 64 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_user_data_exports_user_id').on(table.user_id),
    index('idx_user_data_exports_user_id_status').on(table.user_id, table.status),
    index('idx_user_data_exports_expires_at')
      .on(table.expires_at)
      .where(sql`${table.expires_at} IS NOT NULL`),
    check(
      'user_data_exports_status_check',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`,
    ),
  ],
);
