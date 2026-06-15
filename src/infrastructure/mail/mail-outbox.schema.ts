import { sql } from 'drizzle-orm';
import {
  bigserial,
  jsonb,
  text,
  timestamp,
  varchar,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';

/**
 * Drizzle table for the transactional mail outbox (`auth.mail_outbox`). Inserts
 * commit with the request transaction; the mail worker claims `pending` rows,
 * sends via Resend, then marks them `sent`/`failed`. Status moves through
 * `pending → sending → sent|failed` and is enforced by `mail_outbox_status_check`.
 */
export const mail_outbox = authSchema.table(
  'mail_outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    to_addresses: jsonb('to_addresses').notNull(),
    subject: varchar('subject', { length: 500 }).notNull(),
    html: text('html').notNull(),
    text_body: text('text_body'),
    reply_to: varchar('reply_to', { length: 320 }),
    tags: jsonb('tags'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    resend_message_id: varchar('resend_message_id', { length: 255 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sent_at: timestamp('sent_at', { withTimezone: true }),
    // reaudit-#4: optional caller-supplied idempotency key. When set, a second insert with
    // the same key is a no-op (ON CONFLICT DO NOTHING) and resolves to the existing row, so
    // concurrent producers (e.g. a stalled-then-redelivered notification job) cannot create
    // two outbox rows → two emails. NULL for the common case (no dedup needed).
    dedupe_key: varchar('dedupe_key', { length: 255 }),
  },
  (table) => [
    index('idx_mail_outbox_status_created_at').on(table.status, table.created_at),
    uniqueIndex('idx_mail_outbox_dedupe_key')
      .on(table.dedupe_key)
      .where(sql`${table.dedupe_key} IS NOT NULL`),
    check(
      'mail_outbox_status_check',
      sql`${table.status} IN ('pending', 'sending', 'sent', 'failed')`,
    ),
  ],
);
