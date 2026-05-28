import { sql } from 'drizzle-orm';
import { bigint, varchar, boolean, timestamp, jsonb, check } from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';

/**
 * `auth.user_settings` — a singleton row per user (PK = `user_id`) holding personalization toggles
 * and locale preferences. Cascades on user delete so offboarding sweeps the row automatically;
 * absence of a row is interpreted as the platform default in the serializer.
 */
export const user_settings = authSchema.table(
  'user_settings',
  {
    user_id: bigint('user_id', { mode: 'number' })
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    is_dark_mode_enabled: boolean('is_dark_mode_enabled').notNull().default(false),
    is_notifications_enabled: boolean('is_notifications_enabled').notNull().default(true),
    language: varchar('language', { length: 10 }).notNull().default('en'),
    preferred_locales: jsonb('preferred_locales').notNull().default(['en']),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('chk_user_settings_updated', sql`${table.updated_at} >= ${table.created_at}`)],
);
