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

export const DLQ_REPLAY_SOURCE_QUEUE_NAMES = [
  MAIL_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  STRIPE_WEBHOOK_QUEUE_NAME,
] as const;

export const KNOWN_DEAD_LETTER_QUEUE_NAMES = listDeadLetterQueueNames(
  DLQ_REPLAY_SOURCE_QUEUE_NAMES,
);

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

export type ReplayDeadLetterJobResult =
  | { status: 'replayed'; originalQueue: string }
  | { status: 'not_found' }
  | { status: 'payload_not_reconstructable' };

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

export async function listDeadLetterJobs(deadLetterQueueName: string): Promise<void> {
  const queue = new Queue(deadLetterQueueName, { connection: getBullMQConnectionOptions() });
  try {
    const jobs = await queue.getJobs(['waiting', 'failed'], 0, 99);
    if (jobs.length === 0) {
      // eslint-disable-next-line no-console -- CLI script output for tool:dlq-replay.
      console.log(`${deadLetterQueueName}: (empty)`);
      return;
    }
    for (const job of jobs) {
      const data = job.data as DeadLetterJobData;
      // eslint-disable-next-line no-console -- CLI script output for tool:dlq-replay.
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
    // eslint-disable-next-line no-console -- CLI script output for tool:dlq-replay.
    console.log(`${deadLetterQueueName}: ${jobs.length} job(s)`);
  } finally {
    await queue.close();
  }
}
