import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import {
  findStalePendingMailOutboxIds,
  reclaimStaleSendingMailOutboxIds,
} from '@/infrastructure/mail/mail-outbox.repository.js';
import { enqueueMailOutboxJob } from '@/infrastructure/mail/queues/mail.queue.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const DEFAULT_SWEEP_BATCH_SIZE = 100;

export type MailOutboxSweeperJobResult = {
  scannedCount: number;
  reclaimedSendingCount: number;
  reEnqueuedCount: number;
};

/**
 * Re-enqueues mail_outbox rows stuck in `pending` longer than the configured threshold.
 */
export async function runMailOutboxSweeperJob(): Promise<MailOutboxSweeperJobResult> {
  return withSystemTableWorkerContext(() => runMailOutboxSweeperJobInner());
}

async function runMailOutboxSweeperJobInner(): Promise<MailOutboxSweeperJobResult> {
  const pendingOlderThanMinutes = env.MAIL_OUTBOX_SWEEP_PENDING_MINUTES;
  const cutoff = new Date(Date.now() - pendingOlderThanMinutes * 60_000);
  const batchSize = env.MAIL_OUTBOX_SWEEP_BATCH_SIZE ?? DEFAULT_SWEEP_BATCH_SIZE;

  const reclaimedSendingIds = await reclaimStaleSendingMailOutboxIds(cutoff, batchSize);
  const pendingBatchSize = Math.max(0, batchSize - reclaimedSendingIds.length);
  const stalePendingIds =
    pendingBatchSize > 0 ? await findStalePendingMailOutboxIds(cutoff, pendingBatchSize) : [];
  const staleMailOutboxIds = [...reclaimedSendingIds, ...stalePendingIds];
  let reEnqueuedCount = 0;

  for (const mailOutboxId of staleMailOutboxIds) {
    try {
      await enqueueMailOutboxJob(mailOutboxId, { requestId: 'mail-outbox-sweeper' });
      reEnqueuedCount += 1;
    } catch (error) {
      logger.warn({ error, mailOutboxId }, 'mail-outbox-sweeper.re_enqueue.failed');
    }
  }

  logger.info(
    {
      pendingOlderThanMinutes,
      scannedCount: staleMailOutboxIds.length,
      reclaimedSendingCount: reclaimedSendingIds.length,
      reEnqueuedCount,
    },
    'mail-outbox-sweeper.completed',
  );

  return {
    scannedCount: staleMailOutboxIds.length,
    reclaimedSendingCount: reclaimedSendingIds.length,
    reEnqueuedCount,
  };
}
