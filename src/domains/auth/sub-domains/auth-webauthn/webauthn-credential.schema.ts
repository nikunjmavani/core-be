import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  jsonb,
  text,
  timestamp,
  varchar,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';

export const webauthn_credentials = authSchema.table(
  'webauthn_credentials',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    user_id: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credential_id: text('credential_id').notNull(),
    public_key: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    device_type: varchar('device_type', { length: 32 }).notNull().default('singleDevice'),
    backed_up: boolean('backed_up').notNull().default(false),
    transports: jsonb('transports').notNull().default([]),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('webauthn_credentials_credential_id_unique')
      .on(table.credential_id)
      .where(sql`${table.revoked_at} IS NULL`),
    index('webauthn_credentials_user_id_idx')
      .on(table.user_id)
      .where(sql`${table.revoked_at} IS NULL`),
  ],
);
