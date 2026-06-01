import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';

import { logs } from '@/domains/audit/audit.schema.js';
import { createAuditRetentionWorker } from '@/domains/audit/workers/audit-retention.worker.js';
import { AUDIT_RETENTION_QUEUE_NAME } from '@/domains/audit/workers/audit-retention.constants.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { ensureAuditLogPartitionsForTimestamps } from '@/tests/helpers/audit-log-partition.helper.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { env } from '@/shared/config/env.config.js';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';

/**
 * Verifies the audit retention worker purges rows older than AUDIT_RETENTION_DAYS.
 */
describe('audit-retention.worker — purge', () => {
  let workerHandle: WorkerHandle | null = null;
  let queue: Queue | null = null;
  let queueEvents: QueueEvents | null = null;

  beforeAll(async () => {
    workerHandle = createAuditRetentionWorker();
    queue = new Queue(AUDIT_RETENTION_QUEUE_NAME, {
      connection: getBullMQConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    });
    queueEvents = new QueueEvents(AUDIT_RETENTION_QUEUE_NAME, {
      connection: getBullMQConnectionOptions(),
    });
    await queueEvents.waitUntilReady();
    await workerHandle.worker?.waitUntilReady();
  });

  afterAll(async () => {
    await workerHandle?.close();
    await queue?.close();
    await queueEvents?.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('deletes audit logs older than the retention cutoff', async () => {
    const user = await createTestUser();
    const retentionDays = env.AUDIT_RETENTION_DAYS;
    const staleCreatedAt = new Date();
    staleCreatedAt.setDate(staleCreatedAt.getDate() - retentionDays - 1);
    const recentCreatedAt = new Date();

    await ensureAuditLogPartitionsForTimestamps([staleCreatedAt, recentCreatedAt]);

    await withGlobalRetentionCleanupDatabaseContext(async (databaseHandle) => {
      await databaseHandle.insert(logs).values([
        {
          actor_user_id: user.id,
          action: 'user.login.stale',
          resource_type: 'user',
          created_at: staleCreatedAt,
        },
        {
          actor_user_id: user.id,
          action: 'user.login.recent',
          resource_type: 'user',
          created_at: recentCreatedAt,
        },
      ]);
    });

    const jobId = `audit-retention-${randomUUID()}`;
    const completion = waitForJobCompletion(queueEvents!, jobId);
    await queue!.add('cleanup-old-logs', {}, { jobId, attempts: 1 });
    await completion;

    const remaining = await withGlobalRetentionCleanupDatabaseContext(async (databaseHandle) =>
      databaseHandle.select().from(logs),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.action).toBe('user.login.recent');
  });
});

function waitForJobCompletion(queueEvents: QueueEvents, expectedJobId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onCompleted = (payload: { jobId: string }) => {
      if (payload.jobId !== expectedJobId) return;
      queueEvents.off('completed', onCompleted);
      resolve();
    };
    queueEvents.on('completed', onCompleted);
    setTimeout(() => reject(new Error(`timeout waiting for job ${expectedJobId}`)), 30_000);
  });
}
