import { sql } from 'drizzle-orm';
import { bigint, bigserial, varchar, timestamp, index, pgPolicy } from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';

/** Drizzle table for `auth.verification_tokens` — unified store for magic-link / password-reset / email-verification / email-change tokens; `token_hash` is unique and indexed for replay-safe lookups, RLS-enabled. */
export const verification_tokens = authSchema
  .table(
    'verification_tokens',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      token_type: varchar('token_type', { length: 30 }).notNull(),
      token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
      user_id: bigint('user_id', { mode: 'number' })
        .notNull()
        .references(() => users.id),
      email: varchar('email', { length: 255 }).notNull(),
      expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
      used_at: timestamp('used_at', { withTimezone: true }),
      created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index('idx_verification_tokens_token_hash').on(table.token_hash),
      index('idx_verification_tokens_user_type').on(table.user_id, table.token_type),
      pgPolicy('verification_tokens_application_access', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: sql`true`,
        withCheck: sql`true`,
      }),
    ],
  )
  .enableRLS();
