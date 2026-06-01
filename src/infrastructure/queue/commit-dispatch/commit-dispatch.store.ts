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

/**
 * Loads all pending tasks for a request and removes the durable index entry.
 *
 * @remarks
 * - **Algorithm:** LRANGE the pending list, DEL the list, ZREM the recovery index, parse JSON tasks.
 * - **Failure modes:** invalid JSON entries are logged and skipped; Redis errors propagate.
 * - **Side effects:** mutates Redis keys for `requestId`.
 * - **Notes:** returns an empty array when nothing is pending.
 */
export async function consumeCommitDispatchTasks({
  requestId,
  redis,
}: {
  requestId: string;
  redis?: Redis;
}): Promise<CommitDispatchTask[]> {
  const client = resolveRedis(redis);
  const listKey = pendingListKey(requestId);
  const serializedTasks = await client.lrange(listKey, 0, -1);
  if (serializedTasks.length === 0) {
    await client.zrem(COMMIT_DISPATCH_RECOVERY_ZSET, requestId);
    return [];
  }

  await client.del(listKey);
  await client.zrem(COMMIT_DISPATCH_RECOVERY_ZSET, requestId);

  const tasks: CommitDispatchTask[] = [];
  for (const serializedTask of serializedTasks) {
    try {
      const parsed = JSON.parse(serializedTask) as unknown;
      const validated = commitDispatchTaskSchema.safeParse(parsed);
      if (!validated.success) {
        logger.error(
          { requestId, serializedTask, issues: validated.error.issues },
          'commit-dispatch.task.invalid',
        );
        continue;
      }
      tasks.push(validated.data);
    } catch (error) {
      logger.error({ error, requestId, serializedTask }, 'commit-dispatch.task.parse_failed');
    }
  }
  return tasks;
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
