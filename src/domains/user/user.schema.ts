import { sql } from 'drizzle-orm';
import {
  bigserial,
  varchar,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';

export const users = authSchema.table(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    public_id: varchar('public_id', { length: 21 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    email_hash: varchar('email_hash', { length: 64 }).notNull(),
    is_email_verified: boolean('is_email_verified').notNull().default(false),
    first_name: varchar('first_name', { length: 100 }),
    last_name: varchar('last_name', { length: 100 }),
    avatar_url: varchar('avatar_url', { length: 512 }),
    password_hash: varchar('password_hash', { length: 255 }),
    failed_login_count: integer('failed_login_count').notNull().default(0),
    account_locked_until: timestamp('account_locked_until', { withTimezone: true }),
    last_password_change_at: timestamp('last_password_change_at', { withTimezone: true }),
    is_mfa_enabled: boolean('is_mfa_enabled').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    last_active_at: timestamp('last_active_at', { withTimezone: true }),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_users_public_id').on(table.public_id),
    index('idx_users_email').on(table.email),
    index('idx_users_email_hash').on(table.email_hash),
    index('idx_users_status_deleted').on(table.status, table.deleted_at),
    index('idx_users_last_active').on(table.last_active_at),
    index('idx_users_verified_status').on(table.is_email_verified, table.status),
    uniqueIndex('idx_users_email_unique')
      .on(table.email)
      .where(sql`${table.deleted_at} IS NULL`),
    index('idx_users_created_id_active')
      .on(table.created_at, table.id)
      .where(sql`${table.deleted_at} IS NULL`),
    index('idx_users_last_active_not_deleted')
      .on(table.last_active_at)
      .where(sql`${table.deleted_at} IS NULL`),
    index('idx_users_locked')
      .on(table.account_locked_until)
      .where(sql`${table.account_locked_until} IS NOT NULL`),
    index('idx_users_email_trgm').using('gin', table.email.op('gin_trgm_ops')),
    index('idx_users_display_name_trgm').using(
      'gin',
      sql`(coalesce(${table.first_name}, '') || ' ' || coalesce(${table.last_name}, '')) gin_trgm_ops`,
    ),
    check('chk_users_status', sql`${table.status} IN ('ACTIVE', 'LOCKED', 'SUSPENDED')`),
    check('chk_users_failed_login', sql`${table.failed_login_count} >= 0`),
    check('chk_users_updated', sql`${table.updated_at} >= ${table.created_at}`),
  ],
);
