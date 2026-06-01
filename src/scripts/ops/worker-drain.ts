/**
 * Runbook-as-code: drain the BullMQ worker fleet before scaling workers to zero
 * (pnpm ops:worker:drain).
 *
 * Enumerates every registered queue (from the canonical worker registry), prints current
 * depths (waiting / active / delayed / failed), pauses all queues so no new jobs start, then
 * polls active counts until they reach zero or the drain timeout elapses. Prints
 * "safe to scale to 0" when fully drained, or a timeout summary listing how many jobs remain.
 *
 * The `--resume` flag is the inverse: it unpauses every queue and prints depths, then exits —
 * use it to bring the fleet back after a scale-up.
 *
 * Usage:
 *   pnpm ops:worker:drain                # pause + drain, report when safe to scale to 0
 *   pnpm ops:worker:drain --resume       # resume all queues, then exit
 */
import '@/shared/config/load-env-files.js';
import { parseArgs } from 'node:util';
import { Queue } from 'bullmq';
import {
  closeBullMqRedis,
  connectBullMqRedis,
  getBullMQConnectionOptions,
} from '@/infrastructure/queue/connection.js';
import { getWorkerQueueRegistrationDefinitions } from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';

/** Maximum time to wait for active jobs to finish before reporting a timeout (milliseconds). */
const DRAIN_TIMEOUT_MS = 60_000;

/** Interval between active-count polls while draining (milliseconds). */
const DRAIN_POLL_INTERVAL_MS = 1_000;

interface QueueDepth {
  queueName: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getRegisteredQueueNames(): string[] {
  const names = getWorkerQueueRegistrationDefinitions().map((definition) => definition.queueName);
  return [...new Set(names)];
}

function createQueues(queueNames: string[]): Queue[] {
  const connection = getBullMQConnectionOptions();
  return queueNames.map((queueName) => new Queue(queueName, { connection }));
}

async function readQueueDepth(queue: Queue): Promise<QueueDepth> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  return {
    queueName: queue.name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
  };
}

async function readAllQueueDepths(queues: Queue[]): Promise<QueueDepth[]> {
  return Promise.all(queues.map((queue) => readQueueDepth(queue)));
}

function printQueueDepths({ title, depths }: { title: string; depths: QueueDepth[] }): void {
  console.log(`\n${title}`);
  for (const depth of depths) {
    console.log(
      `  ${depth.queueName}: waiting=${depth.waiting} active=${depth.active} delayed=${depth.delayed} failed=${depth.failed}`,
    );
  }
}

async function countActiveJobs(queues: Queue[]): Promise<number> {
  const activeCounts = await Promise.all(queues.map((queue) => queue.getActiveCount()));
  return activeCounts.reduce((total, count) => total + count, 0);
}

async function pauseAllQueues(queues: Queue[]): Promise<void> {
  await Promise.all(queues.map((queue) => queue.pause()));
  console.log(`\nPaused ${queues.length} queue(s) — no new jobs will start.`);
}

async function resumeAllQueues(queues: Queue[]): Promise<void> {
  await Promise.all(queues.map((queue) => queue.resume()));
  console.log(`\nResumed ${queues.length} queue(s).`);
}

async function waitForActiveDrain(queues: Queue[]): Promise<number> {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  let remaining = await countActiveJobs(queues);
  while (remaining > 0 && Date.now() < deadline) {
    await sleep(DRAIN_POLL_INTERVAL_MS);
    remaining = await countActiveJobs(queues);
  }
  return remaining;
}

async function runDrain(queues: Queue[]): Promise<number> {
  printQueueDepths({
    title: 'Queue depths before drain:',
    depths: await readAllQueueDepths(queues),
  });
  await pauseAllQueues(queues);

  const remainingActive = await waitForActiveDrain(queues);
  printQueueDepths({
    title: 'Queue depths after drain:',
    depths: await readAllQueueDepths(queues),
  });

  if (remainingActive === 0) {
    console.log('\nsafe to scale to 0');
    return 0;
  }
  console.log(
    `\ntimed out after ${DRAIN_TIMEOUT_MS / 1000}s, ${remainingActive} job(s) still active`,
  );
  return 1;
}

async function runResume(queues: Queue[]): Promise<number> {
  await resumeAllQueues(queues);
  printQueueDepths({
    title: 'Queue depths after resume:',
    depths: await readAllQueueDepths(queues),
  });
  return 0;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { resume: { type: 'boolean', default: false } } });

  await connectBullMqRedis();
  const queues = createQueues(getRegisteredQueueNames());
  try {
    process.exitCode = values.resume === true ? await runResume(queues) : await runDrain(queues);
  } finally {
    await Promise.allSettled(queues.map((queue) => queue.close()));
    await closeBullMqRedis();
  }
}

main().catch((error) => {
  console.error('worker-drain failed:', error);
  process.exitCode = 1;
});
