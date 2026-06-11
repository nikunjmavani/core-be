import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { database } from '@/infrastructure/database/connection.js';
import { insertMailOutbox } from '@/infrastructure/mail/mail-outbox.repository.js';
import { mail_outbox } from '@/infrastructure/mail/mail-outbox.schema.js';

const baseEmail = {
  to: 'user@example.com',
  subject: 'Notice',
  html: '<p>hi</p>',
} as const;

describe('insertMailOutbox dedupe_key (reaudit-#4)', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('returns the SAME row id for a repeated dedupeKey and never creates a second row', async () => {
    const key = 'notification:42:email:user@example.com';
    const first = await insertMailOutbox({ ...baseEmail, dedupeKey: key });
    const second = await insertMailOutbox({ ...baseEmail, dedupeKey: key });

    // Concurrent/duplicate producers converge on one idempotent outbox row → one email.
    expect(second).toBe(first);
    const rows = await database
      .select({ id: mail_outbox.id })
      .from(mail_outbox)
      .where(eq(mail_outbox.dedupe_key, key));
    expect(rows).toHaveLength(1);
  });

  it('still creates independent rows when no dedupeKey is supplied (other email paths unaffected)', async () => {
    const a = await insertMailOutbox(baseEmail);
    const b = await insertMailOutbox(baseEmail);
    expect(b).not.toBe(a);
    const all = await database.select({ id: mail_outbox.id }).from(mail_outbox);
    expect(all).toHaveLength(2);
  });
});
