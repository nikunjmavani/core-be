import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { SESSION_CLEANUP_QUEUE_NAME } from '@/domains/auth/sub-domains/auth-session/workers/session-cleanup.constants.js';
import { sessions } from '@/domains/auth/sub-domains/auth-session/auth-session.schema.js';
import { lt, or, eq, and } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import { withSessionRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';

/**
 * BullMQ worker that cleans up expired and revoked sessions.
 * Repeatable schedule is registered in `src/infrastructure/queue/scheduler.ts`.
 */
export function createSessionCleanupWorker(): WorkerHandle {
  const worker = new Worker(
    SESSION_CLEANUP_QUEUE_NAME,
    async () => {
      const retentionDays = env.AUTH_SESSION_RETENTION_DAYS;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      logger.info(
        { retentionDays, cutoffDate: cutoffDate.toISOString() },
        'session-cleanup.starting',
      );

      return withSessionRetentionCleanupDatabaseContext(async (databaseHandle) => {
        const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
          databaseHandle,
          table: sessions,
          idColumn: sessions.id,
          whereCondition: or(
            lt(sessions.expires_at, new Date()),
            and(eq(sessions.is_revoked, true), lt(sessions.created_at, cutoffDate)),
          )!,
          logContext: 'session-cleanup',
          tableLabel: 'auth.sessions',
        });

        logger.info({ deletedCount, blockedCount, retentionDays }, 'session-cleanup.completed');

        return { deletedCount, blockedCount };
      });
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: SESSION_CLEANUP_QUEUE_NAME }, 'session-cleanup.stalled');
  });

  return buildWorkerHandle(worker, SESSION_CLEANUP_QUEUE_NAME);
}
