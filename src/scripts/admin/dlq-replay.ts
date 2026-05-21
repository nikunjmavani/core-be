/**
 * Inspect and replay jobs from BullMQ dead-letter queues (`<source-queue>-dlq`).
 *
 * Usage:
 *   pnpm tool:dlq-replay -- --list
 *   pnpm tool:dlq-replay -- --list mail-dlq
 *   pnpm tool:dlq-replay -- --replay mail-dlq --job-id dlq-mail-123 --actor-user-public-id usr_xxx [--dry-run]
 *   pnpm tool:dlq-replay -- --replay-all webhook-delivery-dlq --actor-user-public-id usr_xxx [--limit 10] [--dry-run]
 */
import { closeDatabase } from '@/infrastructure/database/connection.js';
import { connectRedis, closeRedis } from '@/infrastructure/cache/redis.client.js';
import {
  listDeadLetterJobs,
  replayDeadLetterJob,
  resolveDeadLetterQueueNames,
} from '@/infrastructure/queue/dlq/dlq-replay.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

function parseArguments(): {
  listOnly: boolean;
  deadLetterQueueName: string | undefined;
  replayJobId: string | undefined;
  replayAll: boolean;
  dryRun: boolean;
  limit: number;
  actorUserPublicId: string | undefined;
} {
  const argumentsList = process.argv.slice(2);
  const listIndex = argumentsList.indexOf('--list');
  const replayIndex = argumentsList.indexOf('--replay');
  const replayAll = argumentsList.includes('--replay-all');
  const dryRun = argumentsList.includes('--dry-run');
  const limitIndex = argumentsList.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number.parseInt(argumentsList[limitIndex + 1] ?? '50', 10) : 50;
  const actorIndex = argumentsList.indexOf('--actor-user-public-id');
  const actorUserPublicId = actorIndex >= 0 ? argumentsList[actorIndex + 1] : undefined;

  let deadLetterQueueName: string | undefined;
  const listQueueArgument = listIndex >= 0 ? argumentsList[listIndex + 1] : undefined;
  if (listQueueArgument && !listQueueArgument.startsWith('--')) {
    deadLetterQueueName = listQueueArgument;
  }
  const replayQueueArgument = replayIndex >= 0 ? argumentsList[replayIndex + 1] : undefined;
  if (replayQueueArgument && !replayQueueArgument.startsWith('--')) {
    deadLetterQueueName = replayQueueArgument;
  }
  if (replayAll) {
    const replayAllIndex = argumentsList.indexOf('--replay-all');
    const candidate = argumentsList[replayAllIndex + 1];
    if (candidate && !candidate.startsWith('--')) {
      deadLetterQueueName = candidate;
    }
  }

  const replayJobIdIndex = argumentsList.indexOf('--job-id');
  const replayJobId = replayJobIdIndex >= 0 ? argumentsList[replayJobIdIndex + 1] : undefined;

  return {
    listOnly: listIndex >= 0 && replayIndex < 0 && !replayAll,
    deadLetterQueueName,
    replayJobId,
    replayAll,
    dryRun,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
    actorUserPublicId,
  };
}

async function main(): Promise<void> {
  const parsed = parseArguments();

  if (!(parsed.listOnly || parsed.replayJobId || parsed.replayAll)) {
    console.error(
      'Usage: pnpm tool:dlq-replay -- --list [queue-dlq] | --replay <queue-dlq> --job-id <id> --actor-user-public-id <usr> [--dry-run] | --replay-all <queue-dlq> --actor-user-public-id <usr> [--limit N] [--dry-run]',
    );
    process.exitCode = 1;
    return;
  }

  await connectRedis();

  const queueNames = resolveDeadLetterQueueNames(parsed.deadLetterQueueName);

  if (parsed.listOnly) {
    for (const name of queueNames) {
      await listDeadLetterJobs(name);
    }
    return;
  }

  if (parsed.replayAll) {
    for (const name of queueNames) {
      const queue = await import('bullmq').then((module) => module.Queue);
      const { getBullMQConnectionOptions } = await import('@/infrastructure/queue/connection.js');
      const bullQueue = new queue(name, { connection: getBullMQConnectionOptions() });
      try {
        const jobs = await bullQueue.getJobs(['waiting', 'failed'], 0, parsed.limit - 1);
        for (const job of jobs) {
          // eslint-disable-next-line max-depth -- CLI script with nested job iteration.
          if (!job.id) continue;
          const result = await replayDeadLetterJob(
            omitUndefined({
              deadLetterQueueName: name,
              deadLetterJobId: job.id,
              dryRun: parsed.dryRun,
              actorUserPublicId: parsed.actorUserPublicId,
            }),
          );
          // eslint-disable-next-line max-depth -- CLI script with nested job iteration.
          if (result.status === 'replayed') {
            console.log(
              parsed.dryRun
                ? `[dry-run] Would replay ${job.id} → ${result.originalQueue}`
                : `Replayed ${job.id} → ${result.originalQueue}`,
            );
          }
        }
      } finally {
        await bullQueue.close();
      }
    }
    return;
  }

  if (parsed.replayJobId && queueNames.length === 1) {
    const result = await replayDeadLetterJob(
      omitUndefined({
        deadLetterQueueName: queueNames[0]!,
        deadLetterJobId: parsed.replayJobId,
        dryRun: parsed.dryRun,
        actorUserPublicId: parsed.actorUserPublicId,
      }),
    );
    if (result.status === 'not_found') {
      console.error(`Job not found: ${parsed.replayJobId} in ${queueNames[0]}`);
      process.exitCode = 1;
      return;
    }
    if (result.status === 'payload_not_reconstructable') {
      console.error('Cannot reconstruct replay payload. Re-enqueue manually from Postgres.');
      process.exitCode = 1;
      return;
    }
    console.log(
      parsed.dryRun
        ? `[dry-run] Would replay → ${result.originalQueue}`
        : `Replayed ${parsed.replayJobId} → ${result.originalQueue}`,
    );
    return;
  }

  console.error('--replay requires --job-id, --actor-user-public-id, and a single DLQ queue name');
  process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await closeDatabase();
  });
