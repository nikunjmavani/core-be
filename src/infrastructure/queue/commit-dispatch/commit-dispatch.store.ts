import type { Redis } from 'ioredis';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  commitDispatchTaskSchema,
  type CommitDispatchTask,
} from '@/infrastructure/queue/commit-dispatch/commit-dispatch.types.js';

const COMMIT_DISPATCH_PENDING_KEY_PREFIX = 'commit-dispatch:pending:';
const COMMIT_DISPATCH_RECOVERY_ZSET = 'commit-dispatch:recovery';

/** Minimum age before the recovery sweeper replays unflushed durable tasks (milliseconds). */
export const COMMIT_DISPATCH_RECOVERY_AFTER_MS = 2 * 60_000;

/** TTL on the pending list so orphaned keys do not grow without bound after recovery. */
const COMMIT_DISPATCH_PENDING_TTL_SECONDS = 24 * 60 * 60;

function pendingListKey(requestId: string): string {
  return `${COMMIT_DISPATCH_PENDING_KEY_PREFIX}${requestId}`;
}

function resolveRedis(redis?: Redis): Redis {
  return redis ?? redisConnection;
}

/**
 * Appends a serializable post-commit task to the durable Redis queue for `requestId`.
 * Called synchronously from `scheduleCommitDispatch` so tasks survive a process crash
 * between DB commit and `flushOnCommit`.
 */
export async function appendCommitDispatchTask({
  requestId,
  task,
  redis,
}: {
  requestId: string;
  task: CommitDispatchTask;
  redis?: Redis;
}): Promise<void> {
  const client = resolveRedis(redis);
  const serializedTask = JSON.stringify(task);
  const listKey = pendingListKey(requestId);
  const nowMs = Date.now();

  await client
    .multi()
    .rpush(listKey, serializedTask)
    .expire(listKey, COMMIT_DISPATCH_PENDING_TTL_SECONDS)
    .zadd(COMMIT_DISPATCH_RECOVERY_ZSET, nowMs, requestId)
    .exec();
}

/** A pending task paired with its raw serialized form, used to acknowledge it after execution. */
export interface PendingCommitDispatchTask {
  task: CommitDispatchTask;
  raw: string;
}

/**
 * Reads all pending tasks for a request WITHOUT removing them (reaudit-#2).
 *
 * @remarks
 * - **Algorithm:** LRANGE the pending list, parse + validate JSON tasks, returning each alongside
 *   its raw serialized form. Invalid entries are removed (they can never execute) so they do not
 *   wedge the recovery sweeper.
 * - **Failure modes:** invalid JSON entries are logged, LREM'd, and skipped; Redis errors propagate.
 * - **Side effects:** read-only except for pruning invalid entries; the recovery index entry is
 *   removed only when the list is already empty.
 * - **Notes:** tasks are NOT destroyed here — the caller must
 *   {@link acknowledgeCommitDispatchTask} each one AFTER it executes successfully, so a crash
 *   between read and execute leaves the task for the recovery sweeper (no lost side effect), and a
 *   per-task failure never re-runs the already-acknowledged tasks in the batch.
 */
export async function consumeCommitDispatchTasks({
  requestId,
  redis,
}: {
  requestId: string;
  redis?: Redis;
}): Promise<PendingCommitDispatchTask[]> {
  const client = resolveRedis(redis);
  const listKey = pendingListKey(requestId);
  const serializedTasks = await client.lrange(listKey, 0, -1);
  if (serializedTasks.length === 0) {
    await client.zrem(COMMIT_DISPATCH_RECOVERY_ZSET, requestId);
    return [];
  }

  const tasks: PendingCommitDispatchTask[] = [];
  for (const serializedTask of serializedTasks) {
    try {
      const parsed = JSON.parse(serializedTask) as unknown;
      const validated = commitDispatchTaskSchema.safeParse(parsed);
      if (!validated.success) {
        logger.error(
          { requestId, serializedTask, issues: validated.error.issues },
          'commit-dispatch.task.invalid',
        );
        // Poison entry — remove it so it cannot wedge the recovery sweeper forever.
        await client.lrem(listKey, 0, serializedTask);
        continue;
      }
      tasks.push({ task: validated.data, raw: serializedTask });
    } catch (error) {
      logger.error({ error, requestId, serializedTask }, 'commit-dispatch.task.parse_failed');
      await client.lrem(listKey, 0, serializedTask);
    }
  }
  return tasks;
}

/**
 * Removes one successfully-executed task from the durable list (reaudit-#2).
 *
 * @remarks
 * - **Algorithm:** `LREM listKey 1 raw`; when the list becomes empty, `DEL` it and `ZREM` the
 *   recovery index so the request is no longer swept.
 * - **Failure modes:** Redis errors propagate to the caller (which logs and lets recovery retry).
 * - **Side effects:** mutates the pending list and the recovery index.
 * - **Notes:** call ONLY after the task's side effect succeeded — an unacknowledged task is
 *   retried by the recovery sweeper.
 */
export async function acknowledgeCommitDispatchTask({
  requestId,
  raw,
  redis,
}: {
  requestId: string;
  raw: string;
  redis?: Redis;
}): Promise<void> {
  const client = resolveRedis(redis);
  const listKey = pendingListKey(requestId);
  await client.lrem(listKey, 1, raw);
  const remaining = await client.llen(listKey);
  if (remaining === 0) {
    await client.multi().del(listKey).zrem(COMMIT_DISPATCH_RECOVERY_ZSET, requestId).exec();
  }
}

/**
 * Discards ALL durable tasks for a request without executing them (audit-#M2).
 *
 * @remarks
 * - **Algorithm:** `DEL` the pending list and `ZREM` the recovery-index entry in one `MULTI`.
 * - **Failure modes:** Redis errors propagate to the caller (which logs; the 24h list TTL is the
 *   final backstop so a failed purge cannot leak the key forever).
 * - **Side effects:** removes the pending list and the recovery index entry for `requestId`.
 * - **Notes:** call ONLY when the request's DB transaction rolled back / did not persist, so the
 *   rows the tasks reference provably do not exist. This prevents the recovery sweeper from later
 *   executing orphan tasks against phantom rows (spurious retries → DLQ → false final-failure
 *   alerts). Distinct from {@link acknowledgeCommitDispatchTask}, which removes one task AFTER it
 *   ran successfully.
 */
export async function purgeCommitDispatchTasks({
  requestId,
  redis,
}: {
  requestId: string;
  redis?: Redis;
}): Promise<void> {
  const client = resolveRedis(redis);
  await client
    .multi()
    .del(pendingListKey(requestId))
    .zrem(COMMIT_DISPATCH_RECOVERY_ZSET, requestId)
    .exec();
}

/**
 * Returns request ids whose durable tasks were registered before `olderThanMs` and never flushed.
 *
 * @remarks
 * - **Algorithm:** ZRANGEBYSCORE on the recovery sorted set up to `now - olderThanMs`.
 * - **Failure modes:** Redis errors propagate to the caller.
 * - **Side effects:** read-only Redis access.
 * - **Notes:** bounded by `limit` for sweeper batch sizing.
 */
export async function listStaleCommitDispatchRequestIds({
  olderThanMs,
  limit,
  redis,
}: {
  olderThanMs: number;
  limit: number;
  redis?: Redis;
}): Promise<string[]> {
  const client = resolveRedis(redis);
  const maxScore = Date.now() - olderThanMs;
  return client.zrangebyscore(COMMIT_DISPATCH_RECOVERY_ZSET, 0, maxScore, 'LIMIT', 0, limit);
}
