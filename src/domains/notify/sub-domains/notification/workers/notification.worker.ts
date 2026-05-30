import { Worker, type Job } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { getDefaultWorkerOptions } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { parseJobDataOrDeadLetter } from '@/infrastructure/queue/dlq/poison-job.util.js';
import { runWithPropagatedTraceContext } from '@/infrastructure/observability/tracing/trace-context.util.js';
import { notificationJobDataSchema } from '../queues/notification.job.schema.js';
import { NOTIFICATION_QUEUE_NAME, type NotificationJobData } from '../queues/notification.queue.js';
import { createWorkerNotificationRepository } from '@/domains/notify/sub-domains/notification/notification.repository.js';
import { dispatchOutboxEmail, recordOutboxEmail } from '@/infrastructure/mail/queues/mail.queue.js';
import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import { isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import { buildNotificationEmailHtml } from './notification-email-content.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { getWorkerConcurrencyNotify } from '@/shared/config/worker-concurrency.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import {
  runGlobalRetentionWorkerJob,
  runTenantScopedWorkerJob,
  type WorkerDatabaseHandle,
} from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-database.context.js';
import type { NotificationRepository } from '@/domains/notify/sub-domains/notification/notification.repository.js';

type NotificationDispatchData = {
  channels?: ('email' | 'in_app')[];
  email?: string;
};

/**
 * Hydrate a persisted notification and fan it out across its configured delivery channels
 * (in-app, email). Exported as a pure function so unit tests can drive it with an injected
 * repository instead of spinning up Redis/Postgres.
 *
 * @remarks
 * - **Algorithm:** load the notification row under the correct database context (organization
 *   scope when `organizationPublicId` is set, global retention scope otherwise), then iterate
 *   `data.channels ?? ['in_app']`; for each channel, look up the recipient and send. The email
 *   channel renders the shared transactional template and persists/dispatches via the mail
 *   outbox under `withSystemTableWorkerContext`.
 * - **Failure modes:** missing notification row → throws `notification.not_found:<id>`; absent
 *   mail configuration or recipient logs `notification.worker.channel_skipped` and continues;
 *   outbox write/dispatch errors propagate so BullMQ can retry.
 * - **Side effects:** Postgres reads against `notify.notifications`; mail outbox insert and
 *   BullMQ enqueue on the email channel; structured logs throughout.
 * - **Notes:** when an explicit `notificationRepository` is supplied (tests / worker-scoped
 *   factories) this function skips the database-context wrapper because the caller already
 *   established RLS scope.
 */
export async function processNotificationDispatchJob(
  notificationId: number,
  organizationPublicId: string | null | undefined,
  jobContext: { id?: string; requestId?: string },
  notificationRepository?: NotificationRepository,
): Promise<{ channels: string[] }> {
  const loadNotification = async (databaseHandle: WorkerDatabaseHandle) => {
    const repository = notificationRepository ?? createWorkerNotificationRepository(databaseHandle);
    return repository.findByIdForDispatch(notificationId, organizationPublicId ?? null);
  };

  const notificationRow =
    notificationRepository !== undefined
      ? await notificationRepository.findByIdForDispatch(
          notificationId,
          organizationPublicId ?? null,
        )
      : organizationPublicId === null || organizationPublicId === undefined
        ? await runGlobalRetentionWorkerJob(loadNotification)
        : await withOrganizationContext(organizationPublicId, loadNotification);

  if (!notificationRow) {
    throw new Error(`notification.not_found:${String(notificationId)}`);
  }

  const dispatchData = (notificationRow.data ?? {}) as NotificationDispatchData;
  const channels = dispatchData.channels ?? ['in_app'];
  const email = dispatchData.email ?? notificationRow.userEmail;
  const { type, title, message, actionUrl } = notificationRow;

  logger.info(
    { jobId: jobContext.id, requestId: jobContext.requestId, notificationId, type, channels },
    'notification.worker.processing',
  );

  const results: string[] = [];

  for (const channel of channels) {
    switch (channel) {
      case 'email': {
        if (!(isMailConfigured() && email)) {
          logger.warn({ channel, notificationId }, 'notification.worker.channel_skipped');
          break;
        }

        const { subject, html } = buildNotificationEmailHtml({ title, message, actionUrl });

        await withSystemTableWorkerContext(async () => {
          const mailOutboxId = await recordOutboxEmail({
            to: email,
            subject,
            html,
            tags: [{ name: 'category', value: `notification-${type}` }],
          });
          await dispatchOutboxEmail(
            mailOutboxId,
            jobContext.requestId ? { requestId: jobContext.requestId } : undefined,
          );
        });

        results.push('email:queued');
        break;
      }

      case 'in_app':
        results.push('in_app:persisted');
        break;
    }
  }

  return { channels: results };
}

async function processTenantScopedNotificationJob(
  databaseHandle: WorkerDatabaseHandle,
  job: Job<NotificationJobData>,
): Promise<{ channels: string[] }> {
  const { notificationId, organizationPublicId, requestId } = job.data;
  return processNotificationDispatchJob(
    notificationId,
    organizationPublicId,
    omitUndefined({ id: job.id, requestId }),
    createWorkerNotificationRepository(databaseHandle),
  );
}

/**
 * Creates a BullMQ worker that processes notification dispatch jobs.
 * Routes notifications to configured channels (email, in-app).
 *
 * @remarks
 * - **Algorithm:** for each job, branch on `organizationPublicId`: tenant-scoped jobs run inside
 *   `runTenantScopedWorkerJob` (`withOrganizationContext`) so RLS pins reads to the org;
 *   global / system notifications (no org id) run inside `runGlobalRetentionWorkerJob`. Both
 *   paths build a worker-scoped {@link NotificationRepository} from the database handle and
 *   delegate to {@link processNotificationDispatchJob} for per-channel fan-out.
 * - **Failure modes:** BullMQ retries on thrown errors using the queue's exponential backoff
 *   (3 attempts); stalls and completions are logged via the worker listeners.
 * - **Side effects:** subscribes a `Worker` to {@link NOTIFICATION_QUEUE_NAME}; reads notification
 *   rows; writes to the mail outbox and enqueues mail jobs for the email channel.
 * - **Notes:** concurrency comes from `getWorkerConcurrencyNotify()`; default worker options
 *   provide stall + lock tuning. The returned handle wires graceful shutdown into bootstrap.
 */
export function createNotificationWorker(): WorkerHandle {
  const worker = new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      const { notificationId, organizationPublicId, requestId, traceparent, tracestate } =
        await parseJobDataOrDeadLetter({
          schema: notificationJobDataSchema,
          job,
          queueName: NOTIFICATION_QUEUE_NAME,
        });

      return runWithPropagatedTraceContext({ traceparent, tracestate }, job.name, () => {
        if (organizationPublicId === null || organizationPublicId === undefined) {
          return runGlobalRetentionWorkerJob((databaseHandle) =>
            processNotificationDispatchJob(
              notificationId,
              organizationPublicId,
              omitUndefined({ id: job.id, requestId }),
              createWorkerNotificationRepository(databaseHandle),
            ),
          );
        }

        return runTenantScopedWorkerJob(
          { organizationPublicId, notificationId, requestId },
          (databaseHandle) => processTenantScopedNotificationJob(databaseHandle, job),
        );
      });
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: getWorkerConcurrencyNotify(),
      ...getDefaultWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: NOTIFICATION_QUEUE_NAME }, 'notification.worker.stalled');
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job?.id }, 'notification.worker.completed');
  });

  return buildWorkerHandle(worker, NOTIFICATION_QUEUE_NAME);
}
