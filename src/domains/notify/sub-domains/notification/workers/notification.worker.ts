import { Worker, type Job } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { getDefaultWorkerOptions } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { NOTIFICATION_QUEUE_NAME, type NotificationJobData } from '../queues/notification.queue.js';
import { createWorkerNotificationRepository } from '@/domains/notify/sub-domains/notification/notification.repository.js';
import { dispatchOutboxEmail, recordOutboxEmail } from '@/infrastructure/mail/queues/mail.queue.js';
import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database-context.js';
import { isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import { baseTemplate } from '@/infrastructure/mail/templates/base.template.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { getWorkerConcurrencyNotify } from '@/shared/config/worker-concurrency.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import {
  runGlobalRetentionWorkerJob,
  runTenantScopedWorkerJob,
  type WorkerDatabaseHandle,
} from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-context.js';
import type { NotificationRepository } from '@/domains/notify/sub-domains/notification/notification.repository.js';

type NotificationDispatchData = {
  channels?: ('email' | 'in_app')[];
  email?: string;
};

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
        if (!isMailConfigured() || !email) {
          logger.warn({ channel, notificationId }, 'notification.worker.channel_skipped');
          break;
        }

        const html = baseTemplate({
          title,
          preheader: message,
          body: `
                <h1>${title}</h1>
                <p>${message}</p>
                ${actionUrl ? `<p style="text-align: center; margin: 32px 0;"><a href="${actionUrl}" class="button">View Details</a></p>` : ''}
              `,
        });

        await withSystemTableWorkerContext(async () => {
          const mailOutboxId = await recordOutboxEmail({
            to: email,
            subject: title,
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
 */
export function createNotificationWorker(): WorkerHandle {
  const worker = new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      const { notificationId, organizationPublicId, requestId } = job.data;

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
