import {
  acknowledgeCommitDispatchTask,
  COMMIT_DISPATCH_RECOVERY_AFTER_MS,
  consumeCommitDispatchTasks,
  listStaleCommitDispatchRequestIds,
} from '@/infrastructure/queue/commit-dispatch/commit-dispatch.store.js';
import { DEFAULT_COMMIT_DISPATCH_RECOVERY_BATCH_SIZE } from '@/shared/constants/limits.constants.js';
import { executeCommitDispatchTask } from '@/infrastructure/queue/commit-dispatch/commit-dispatch.executor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { isSentryInitialized, Sentry } from '@/infrastructure/observability/sentry/sentry.js';

/**
 * Outcome counters for one commit-dispatch recovery sweeper pass.
 *
 * @remarks
 * - **Algorithm:** populated by {@link runCommitDispatchRecoveryJob} after scanning stale request ids.
 * - **Failure modes:** counts are best-effort — failed task execution still increments `scannedCount`.
 * - **Side effects:** none from this type alone.
 * - **Notes:** logged at `info` when any stale ids were found.
 */
export type CommitDispatchRecoveryJobResult = {
  scannedCount: number;
  executedCount: number;
};

/**
 * Replays durable post-commit tasks whose HTTP request never reached `flushOnCommit`.
 *
 * @remarks
 * - **Algorithm:** list stale request ids, consume each Redis task list, execute tasks.
 * - **Failure modes:** per-task failures are logged at warn; Redis list errors skip remaining ids in the batch.
 * - **Side effects:** enqueues BullMQ jobs and may mutate Postgres on failure cleanup paths.
 * - **Notes:** bounded batch size; safe to run concurrently with normal flush (idempotent tasks).
 */
export async function runCommitDispatchRecoveryJob(): Promise<CommitDispatchRecoveryJobResult> {
  const staleRequestIds = await listStaleCommitDispatchRequestIds({
    olderThanMs: COMMIT_DISPATCH_RECOVERY_AFTER_MS,
    limit: DEFAULT_COMMIT_DISPATCH_RECOVERY_BATCH_SIZE,
  });

  let executedCount = 0;
  for (const requestId of staleRequestIds) {
    const tasks = await consumeCommitDispatchTasks({ requestId });
    for (const { task, raw } of tasks) {
      try {
        await executeCommitDispatchTask(task);
        // reaudit-#2: acknowledge (remove) only after the side effect succeeded, so a crash
        // mid-replay does not lose the remaining tasks and does not re-run the done ones.
        await acknowledgeCommitDispatchTask({ requestId, raw });
        executedCount += 1;
      } catch (error) {
        logger.warn({ error, requestId, task }, 'commit-dispatch-recovery.task.failed');
        // sec-new-Q2: surface per-task failures in Sentry so they are not
        // silently swallowed — the logger.warn above is too easy to miss in
        // production dashboards.
        if (isSentryInitialized()) {
          Sentry.captureException(error);
        }
      }
    }
  }

  if (staleRequestIds.length > 0) {
    logger.info(
      { scannedCount: staleRequestIds.length, executedCount },
      'commit-dispatch-recovery.completed',
    );
  }

  return { scannedCount: staleRequestIds.length, executedCount };
}
