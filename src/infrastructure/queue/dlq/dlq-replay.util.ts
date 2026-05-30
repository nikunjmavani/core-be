import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { logs } from '@/domains/audit/audit.schema.js';
import { users } from '@/domains/user/user.schema.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  DLQ_QUEUE_SUFFIX,
  type DeadLetterJobData,
  listDeadLetterQueueNames,
} from '@/infrastructure/queue/dlq/dead-letter.js';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js';
import { NOTIFICATION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Source queues whose DLQ payloads {@link buildReplayJobPayload} knows how to reconstruct.
 * Retention/observability DLQs are intentionally excluded — their jobs carry no business
 * payload worth replaying, so operators must clear them manually.
 */
export const DLQ_REPLAY_SOURCE_QUEUE_NAMES = [
  MAIL_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  STRIPE_WEBHOOK_QUEUE_NAME,
] as const;

/** DLQ queue names accepted by the `tool:dlq-replay` CLI (derived from {@link DLQ_REPLAY_SOURCE_QUEUE_NAMES}). */
export const KNOWN_DEAD_LETTER_QUEUE_NAMES = listDeadLetterQueueNames(
  DLQ_REPLAY_SOURCE_QUEUE_NAMES,
);

/**
 * Normalises an operator-supplied queue filter (with or without the `-dlq` suffix) into a
 * concrete list of DLQ names to inspect. Throws when the filter does not match a known
 * replayable queue. With no filter, returns every replayable DLQ.
 */
export function resolveDeadLetterQueueNames(filter?: string): string[] {
  if (!filter) return [...KNOWN_DEAD_LETTER_QUEUE_NAMES];
  const normalized = filter.endsWith(DLQ_QUEUE_SUFFIX) ? filter : `${filter}${DLQ_QUEUE_SUFFIX}`;
  if (!KNOWN_DEAD_LETTER_QUEUE_NAMES.includes(normalized)) {
    throw new Error(
      `Unknown DLQ queue: ${filter}. Known: ${KNOWN_DEAD_LETTER_QUEUE_NAMES.join(', ')}`,
    );
  }
  return [normalized];
}

/**
 * Reconstructs the minimal job payload needed to re-enqueue a dead-lettered job onto its
 * original BullMQ queue. Mail, webhook delivery, notification, and Stripe webhook jobs each
 * pull their required identifiers out of {@link DeadLetterJobData.original_data_summary}:
 * mail (`mail_outbox_id`), webhook (`delivery_attempt_id` + `organization_public_id`),
 * notification (`notification_id` + nullable `organization_public_id`), Stripe
 * (`stripe_event_id`). Queues without a known shape (retention/observability DLQs), or whose
 * summary is missing a required key, return `null` so the caller skips the replay. The
 * resulting payload is tagged with {@link DlqReplayJobFields} markers so the receiving worker
 * can detect a replay.
 */
export function buildReplayJobPayload(data: DeadLetterJobData): Record<string, unknown> | null {
  const summary = data.original_data_summary;
  let basePayload: Record<string, unknown> | null = null;

  switch (data.original_queue) {
    case MAIL_QUEUE_NAME: {
      const mailOutboxId = summary.mail_outbox_id;
      if (typeof mailOutboxId !== 'number') return null;
      basePayload = { mailOutboxId };
      break;
    }
    case WEBHOOK_DELIVERY_QUEUE_NAME: {
      const deliveryAttemptId = summary.delivery_attempt_id;
      const organizationPublicId = summary.organization_public_id;
      if (typeof deliveryAttemptId !== 'number' || typeof organizationPublicId !== 'string') {
        return null;
      }
      basePayload = { deliveryAttemptId, organizationPublicId };
      break;
    }
    case NOTIFICATION_QUEUE_NAME: {
      const notificationId = summary.notification_id;
      if (typeof notificationId !== 'number') return null;
      // Notification jobs carry a nullable org scope; preserve null (global notifications)
      // and only forward a concrete public id when present.
      const organizationPublicId = summary.organization_public_id;
      basePayload = {
        notificationId,
        organizationPublicId:
          typeof organizationPublicId === 'string' ? organizationPublicId : null,
      };
      break;
    }
    case STRIPE_WEBHOOK_QUEUE_NAME: {
      const stripeEventId = summary.stripe_event_id;
      if (typeof stripeEventId !== 'string') return null;
      basePayload = { stripeEventId };
      break;
    }
    default:
      return null;
  }

  return {
    ...basePayload,
    replayFromDlq: true,
    dlqReplayAttempt: data.replay_attempt ?? 0,
  };
}

/**
 * Writes a `queue.dlq.replayed` row to `audit.logs` so every DLQ replay carries an actor
 * trail (resolves the supplied user public id to an internal numeric `actor_user_id`).
 * Throws when the actor is unknown — the caller in {@link replayDeadLetterJob} treats this
 * as a fatal pre-condition.
 */
export async function recordDlqReplayAuditEntry(input: {
  actorUserPublicId: string;
  deadLetterQueueName: string;
  deadLetterJobId: string;
  data: DeadLetterJobData;
}): Promise<void> {
  const [actorRow] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.public_id, input.actorUserPublicId))
    .limit(1);

  if (!actorRow) {
    throw new Error(`Unknown actor user public id: ${input.actorUserPublicId}`);
  }

  await database.insert(logs).values({
    actor_user_id: actorRow.id,
    action: 'queue.dlq.replayed',
    resource_type: 'bullmq_dead_letter_job',
    severity: 'INFO',
    metadata: {
      dead_letter_queue: input.deadLetterQueueName,
      dead_letter_job_id: input.deadLetterJobId,
      original_queue: input.data.original_queue,
      original_job_id: input.data.original_job_id,
      replay_attempt: input.data.replay_attempt ?? 0,
    },
  });
}

/**
 * Outcome of {@link replayDeadLetterJob}: either the job was re-enqueued (or simulated in
 * dry-run mode), the DLQ entry vanished before we could read it, or the payload shape was
 * not in {@link DLQ_REPLAY_SOURCE_QUEUE_NAMES} and cannot be reconstructed.
 */
export type ReplayDeadLetterJobResult =
  | { status: 'replayed'; originalQueue: string }
  | { status: 'not_found' }
  | { status: 'payload_not_reconstructable' };

/**
 * Replays a single dead-lettered job: looks it up, reconstructs its payload, adds it back
 * to the source queue (re-using the original `jobId` so downstream idempotency keys hit),
 * removes the DLQ entry, and writes an audit row. In `dryRun` mode no Redis or Postgres
 * writes happen and `actorUserPublicId` is not required.
 */
export async function replayDeadLetterJob(input: {
  deadLetterQueueName: string;
  deadLetterJobId: string;
  dryRun: boolean;
  actorUserPublicId?: string;
}): Promise<ReplayDeadLetterJobResult> {
  const queue = new Queue(input.deadLetterQueueName, { connection: getBullMQConnectionOptions() });
  try {
    const job = await queue.getJob(input.deadLetterJobId);
    if (!job) {
      return { status: 'not_found' };
    }

    const data = job.data as DeadLetterJobData;
    const payload = buildReplayJobPayload(data);
    if (!payload) {
      return { status: 'payload_not_reconstructable' };
    }

    if (input.dryRun) {
      logger.info({ originalQueue: data.original_queue, payload }, 'dlq.replay.dry_run');
      return { status: 'replayed', originalQueue: data.original_queue };
    }

    if (!input.actorUserPublicId) {
      throw new Error('--actor-user-public-id is required for DLQ replay (audit log)');
    }

    const sourceQueue = new Queue(data.original_queue, {
      connection: getBullMQConnectionOptions(),
    });
    try {
      await sourceQueue.add(
        data.original_job_name,
        payload,
        omitUndefined({
          jobId: data.original_job_id ? String(data.original_job_id) : undefined,
        }),
      );
      await job.remove();
      await recordDlqReplayAuditEntry({
        actorUserPublicId: input.actorUserPublicId,
        deadLetterQueueName: input.deadLetterQueueName,
        deadLetterJobId: input.deadLetterJobId,
        data,
      });
      return { status: 'replayed', originalQueue: data.original_queue };
    } finally {
      await sourceQueue.close();
    }
  } finally {
    await queue.close();
  }
}

/**
 * Prints the first 100 waiting/failed jobs from a DLQ to stdout in a tab-separated layout
 * (`jobId\toriginal_queue\toriginal_job_name\treplay_attempt=N\tfailed_reason`). Used only
 * by the `tool:dlq-replay` CLI; never call from API or worker code.
 */
export async function listDeadLetterJobs(deadLetterQueueName: string): Promise<void> {
  const queue = new Queue(deadLetterQueueName, { connection: getBullMQConnectionOptions() });
  try {
    const jobs = await queue.getJobs(['waiting', 'failed'], 0, 99);
    if (jobs.length === 0) {
      // biome-ignore lint/suspicious/noConsole: tabular CLI output for tool:dlq-replay (terminal user, not log aggregator).
      console.log(`${deadLetterQueueName}: (empty)`);
      return;
    }
    for (const job of jobs) {
      const data = job.data as DeadLetterJobData;
      // biome-ignore lint/suspicious/noConsole: tabular CLI output for tool:dlq-replay (terminal user, not log aggregator).
      console.log(
        [
          job.id,
          data.original_queue,
          data.original_job_name,
          `replay_attempt=${String(data.replay_attempt ?? 0)}`,
          data.failed_reason?.slice(0, 60) ?? '',
        ].join('\t'),
      );
    }
    // biome-ignore lint/suspicious/noConsole: tabular CLI output for tool:dlq-replay (terminal user, not log aggregator).
    console.log(`${deadLetterQueueName}: ${jobs.length} job(s)`);
  } finally {
    await queue.close();
  }
}
