import { and, asc, count, eq, inArray, lt } from 'drizzle-orm';
import { resolveRepositoryDatabaseHandle } from '@/infrastructure/database/contexts/worker-database-guard.util.js';
import {
  assertWorkerDatabaseContext,
  isWorkerRuntime,
} from '@/infrastructure/database/contexts/worker-database.context.js';
import { mail_outbox } from '@/infrastructure/mail/mail-outbox.schema.js';
import type { MailEnqueueInput } from '@/infrastructure/mail/queues/mail.queue.js';

export type MailOutboxClaimResult = 'claimed' | 'in_flight' | 'already_sent' | 'not_found';

function mailOutboxDatabase() {
  if (isWorkerRuntime()) {
    assertWorkerDatabaseContext(['system_table']);
  }
  return resolveRepositoryDatabaseHandle(undefined);
}

export async function insertMailOutbox(data: MailEnqueueInput): Promise<number> {
  const toAddresses = Array.isArray(data.to) ? data.to : [data.to];
  const rows = await mailOutboxDatabase()
    .insert(mail_outbox)
    .values({
      to_addresses: toAddresses,
      subject: data.subject,
      html: data.html,
      text_body: data.text,
      reply_to: data.replyTo,
      tags: data.tags,
      status: 'pending',
    })
    .returning({ id: mail_outbox.id });
  const mailOutboxId = rows[0]?.id;
  if (mailOutboxId === undefined) {
    throw new Error('Failed to insert mail outbox row');
  }
  return mailOutboxId;
}

export async function findMailOutboxById(mailOutboxId: number) {
  const rows = await mailOutboxDatabase()
    .select()
    .from(mail_outbox)
    .where(eq(mail_outbox.id, mailOutboxId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomically claims a pending outbox row for delivery (`pending` → `sending`).
 */
export async function tryClaimPendingMailOutbox(
  mailOutboxId: number,
): Promise<MailOutboxClaimResult> {
  const claimedRows = await mailOutboxDatabase()
    .update(mail_outbox)
    .set({ status: 'sending', updated_at: new Date() })
    .where(and(eq(mail_outbox.id, mailOutboxId), eq(mail_outbox.status, 'pending')))
    .returning({ id: mail_outbox.id });

  if (claimedRows.length > 0) {
    return 'claimed';
  }

  const existingRow = await findMailOutboxById(mailOutboxId);
  if (!existingRow) {
    return 'not_found';
  }
  if (existingRow.status === 'sent') {
    return 'already_sent';
  }
  return 'in_flight';
}

/** Moves stuck `sending` rows back to `pending` for the outbox sweeper. */
export async function reclaimStaleSendingMailOutboxIds(
  stuckSendingBefore: Date,
  limit: number,
): Promise<number[]> {
  const staleRows = await mailOutboxDatabase()
    .select({ id: mail_outbox.id })
    .from(mail_outbox)
    .where(and(eq(mail_outbox.status, 'sending'), lt(mail_outbox.updated_at, stuckSendingBefore)))
    .orderBy(asc(mail_outbox.updated_at))
    .limit(limit);

  if (staleRows.length === 0) {
    return [];
  }

  const staleIds = staleRows.map((row) => row.id);
  const reclaimedRows = await mailOutboxDatabase()
    .update(mail_outbox)
    .set({ status: 'pending', updated_at: new Date() })
    .where(
      and(
        eq(mail_outbox.status, 'sending'),
        inArray(mail_outbox.id, staleIds),
        lt(mail_outbox.updated_at, stuckSendingBefore),
      ),
    )
    .returning({ id: mail_outbox.id });

  return reclaimedRows.map((row) => row.id);
}

/** Pending rows older than the cutoff (for the outbox sweeper repeatable job). */
export async function findStalePendingMailOutboxIds(
  pendingOlderThan: Date,
  limit: number,
): Promise<number[]> {
  const rows = await mailOutboxDatabase()
    .select({ id: mail_outbox.id })
    .from(mail_outbox)
    .where(and(eq(mail_outbox.status, 'pending'), lt(mail_outbox.created_at, pendingOlderThan)))
    .orderBy(asc(mail_outbox.created_at))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function markMailOutboxSent(
  mailOutboxId: number,
  resendMessageId: string,
): Promise<void> {
  await mailOutboxDatabase()
    .update(mail_outbox)
    .set({
      status: 'sent',
      resend_message_id: resendMessageId,
      sent_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(mail_outbox.id, mailOutboxId));
}

export async function markMailOutboxFailed(mailOutboxId: number): Promise<void> {
  await mailOutboxDatabase()
    .update(mail_outbox)
    .set({ status: 'failed', updated_at: new Date() })
    .where(eq(mail_outbox.id, mailOutboxId));
}

/** Reverts a claimed row to `pending` so BullMQ retries can call Resend again. */
export async function releaseMailOutboxClaim(mailOutboxId: number): Promise<void> {
  await mailOutboxDatabase()
    .update(mail_outbox)
    .set({ status: 'pending', updated_at: new Date() })
    .where(and(eq(mail_outbox.id, mailOutboxId), eq(mail_outbox.status, 'sending')));
}

export async function countPendingMailOutbox(): Promise<number> {
  const rows = await mailOutboxDatabase()
    .select({ count: count() })
    .from(mail_outbox)
    .where(eq(mail_outbox.status, 'pending'));
  return rows[0]?.count ?? 0;
}
