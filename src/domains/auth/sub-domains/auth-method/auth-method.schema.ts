import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';

/** Drizzle table for `auth.auth_methods` — one row per linked credential (PASSWORD, MAGIC_LINK, OAUTH, MFA_TOTP, MFA_SMS, MFA_EMAIL); soft-deleted via `revoked_at`. */
export const auth_methods = authSchema.table(
  'auth_methods',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    user_id: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    method_type: varchar('method_type', { length: 20 }).notNull(),
    provider: varchar('provider', { length: 50 }),
    provider_user_id: varchar('provider_user_id', { length: 255 }),
    encrypted_secret: text('encrypted_secret'),
    phone_number: varchar('phone_number', { length: 20 }),
    is_primary: boolean('is_primary').notNull().default(false),
    verified_at: timestamp('verified_at', { withTimezone: true }),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    created_by_user_id: bigint('created_by_user_id', { mode: 'number' }).references(() => users.id),
  },
  (table) => [
    index('idx_auth_methods_user_type').on(table.user_id, table.method_type),
    index('idx_auth_methods_provider').on(table.provider, table.provider_user_id),
    index('idx_auth_methods_user_revoked').on(table.user_id, table.revoked_at),
    index('idx_auth_methods_user_primary').on(table.user_id, table.is_primary),
    check(
      'chk_auth_methods_type',
      sql`${table.method_type} IN ('PASSWORD', 'MAGIC_LINK', 'OAUTH', 'MFA_TOTP', 'MFA_SMS', 'MFA_EMAIL')`,
    ),
  ],
);

// Note: magic_link_tokens table has been replaced by the unified verification_tokens table.
// See verification-token.schema.ts for the new schema.
