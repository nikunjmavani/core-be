import { sql } from 'drizzle-orm';
import { bigserial, jsonb, text, timestamp, varchar, index, check } from 'drizzle-orm/pg-core';
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
  },
  (table) => [
    index('idx_mail_outbox_status_created_at').on(table.status, table.created_at),
    check(
      'mail_outbox_status_check',
      sql`${table.status} IN ('pending', 'sending', 'sent', 'failed')`,
    ),
  ],
);
