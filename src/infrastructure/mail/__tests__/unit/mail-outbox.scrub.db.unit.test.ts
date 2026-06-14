import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { database } from '@/infrastructure/database/connection.js';
import {
  insertMailOutbox,
  markMailOutboxFailed,
  markMailOutboxSent,
} from '@/infrastructure/mail/mail-outbox.repository.js';
import { mail_outbox } from '@/infrastructure/mail/mail-outbox.schema.js';

/**
 * sec-audit-#10 / sec-r5-crypto-1: magic-link, invitation, password-reset, and email-verification
 * templates embed the live single-use token directly in the rendered HTML/text body. A terminal
 * `mail_outbox` row (sent OR failed) is retained for the audit trail and is just as readable from a
 * PITR snapshot, a leaked operator console, SQLi, or a compromised `core_be_app` credential — so the
 * body MUST be scrubbed once the row reaches a terminal state. These tests pin that both terminal
 * transitions wipe `html` / `text_body` while preserving the non-secret audit columns.
 */
const secretBearingEmail = {
  to: 'user@example.com',
  subject: 'Reset your password',
  html: '<a href="https://app.example.com/reset?token=live-single-use-secret">Reset</a>',
  text: 'Reset: https://app.example.com/reset?token=live-single-use-secret',
} as const;

describe('mail-outbox terminal-state body scrub (sec-audit-#10)', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('markMailOutboxFailed scrubs the secret-bearing body on terminal failure', async () => {
    const id = await insertMailOutbox(secretBearingEmail);

    // Sanity: the body (with the live token) is present before the terminal transition.
    const [pending] = await database
      .select()
      .from(mail_outbox)
      .where(eq(mail_outbox.id, id))
      .limit(1);
    expect(pending?.html).toContain('live-single-use-secret');

    await markMailOutboxFailed(id);

    const [failed] = await database
      .select()
      .from(mail_outbox)
      .where(eq(mail_outbox.id, id))
      .limit(1);
    expect(failed?.status).toBe('failed');
    // The token-bearing body is gone; a manual resend must mint a NEW token, never replay this row.
    expect(failed?.html).toBe('');
    expect(failed?.text_body).toBeNull();
    // Non-secret audit columns are retained for follow-up.
    expect(failed?.subject).toBe(secretBearingEmail.subject);
    expect(failed?.to_addresses).toEqual([secretBearingEmail.to]);
  });

  it('markMailOutboxSent scrubs the secret-bearing body on successful send', async () => {
    const id = await insertMailOutbox(secretBearingEmail);

    await markMailOutboxSent(id, 'resend_msg_123');

    const [sent] = await database.select().from(mail_outbox).where(eq(mail_outbox.id, id)).limit(1);
    expect(sent?.status).toBe('sent');
    expect(sent?.html).toBe('');
    expect(sent?.text_body).toBeNull();
    // Delivery metadata retained for the audit trail.
    expect(sent?.resend_message_id).toBe('resend_msg_123');
    expect(sent?.sent_at).not.toBeNull();
  });
});
