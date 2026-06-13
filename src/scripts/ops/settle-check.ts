/**
 * Post-load settle-and-assert-clean gate (`pnpm load:settle-check`).
 *
 * Run this after a load or e2e batch against the same running API + worker the run
 * hit, to prove the async fabric finished every job it started: it polls the
 * throughput queues until their backlog and the mail outbox drain to zero, then
 * asserts — once — that no queue and no `<queue>-dlq` is holding a failed job.
 * Exits 0 when clean, 1 when it does not settle within the timeout or a failure
 * remains, so it can gate a CI load job.
 *
 * Workers MUST be running (`pnpm dev:worker`) so the backlog can actually drain.
 * Scheduled retention/tombstone queues are intentionally excluded because their
 * next repeatable run always sits in `delayed` and never reaches zero — their
 * health is covered instead by the cluster-wide dead-letter assertion.
 *
 * Usage:
 *   pnpm load:settle-check
 * Env:
 *   SETTLE_CHECK_TIMEOUT_MS        max wait for the backlog to drain (default 120000)
 *   SETTLE_CHECK_POLL_INTERVAL_MS  poll cadence while waiting (default 2000)
 *   SETTLE_CHECK_QUEUES            comma-separated queue override (default throughput queues)
 */
import '@/shared/config/load-env-files.js';
import { Queue } from 'bullmq';
import { closeRedis, connectRedis } from '@/infrastructure/cache/redis.client.js';
import { closeDatabase } from '@/infrastructure/database/connection.js';
import { countPendingMailOutbox } from '@/infrastructure/mail/mail-outbox.repository.js';
import { getTotalDeadLetterJobCount } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import {
  closeBullMqRedis,
  connectBullMqRedis,
  getBullMQConnectionOptions,
} from '@/infrastructure/queue/connection.js';
import {
  readWorkerQueueHeartbeats,
  WORKER_THROUGHPUT_QUEUE_NAMES,
} from '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js';
import {
  evaluateSettleCheck,
  formatSettleCheckReport,
  isInFlightDrained,
  type InFlightSnapshot,
  type QueueDepthSnapshot,
  type SettleCheckSnapshot,
} from './settle-check.evaluate.js';

/** Default ceiling on how long to wait for the throughput backlog to drain (milliseconds). */
const DEFAULT_TIMEOUT_MILLISECONDS = 120_000;

/** Default interval between drain polls (milliseconds). */
const DEFAULT_POLL_INTERVAL_MILLISECONDS = 2_000;

function parsePositiveIntegerEnv(rawValue: string | undefined, fallback: number): number {
  if (rawValue === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveQueueNames(): string[] {
  const override = process.env.SETTLE_CHECK_QUEUES;
  if (override === undefined || override.trim() === '') {
    return [...WORKER_THROUGHPUT_QUEUE_NAMES];
  }
  return override
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function readQueueDepth(queue: Queue): Promise<QueueDepthSnapshot> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  return {
    queue: queue.name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
  };
}

async function readInFlight(queues: Queue[]): Promise<InFlightSnapshot> {
  const [queueDepths, mailOutboxPending] = await Promise.all([
    Promise.all(queues.map((queue) => readQueueDepth(queue))),
    countPendingMailOutbox(),
  ]);
  return { queues: queueDepths, mailOutboxPending };
}

async function main(): Promise<void> {
  const timeoutMilliseconds = parsePositiveIntegerEnv(
    process.env.SETTLE_CHECK_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MILLISECONDS,
  );
  const pollIntervalMilliseconds = parsePositiveIntegerEnv(
    process.env.SETTLE_CHECK_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MILLISECONDS,
  );
  const queueNames = resolveQueueNames();

  let queues: Queue[] = [];
  try {
    await Promise.all([connectRedis(), connectBullMqRedis()]);
    const connection = getBullMQConnectionOptions();
    queues = queueNames.map((name) => new Queue(name, { connection }));

    const startedAt = performance.now();
    const deadline = Date.now() + timeoutMilliseconds;
    let timedOut = false;
    let drained = isInFlightDrained(await readInFlight(queues));
    while (!drained) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      await sleep(pollIntervalMilliseconds);
      drained = isInFlightDrained(await readInFlight(queues));
    }

    // Authoritative final sample. Re-reads the queues (now including `failed`) and
    // adds the cluster-wide dead-letter total — both are terminal states that never
    // drain on their own, so they are asserted once rather than polled.
    const [queueDepths, mailOutboxPending, deadLetterTotal, heartbeats] = await Promise.all([
      Promise.all(queues.map((queue) => readQueueDepth(queue))),
      countPendingMailOutbox(),
      getTotalDeadLetterJobCount(),
      readWorkerQueueHeartbeats(queueNames),
    ]);

    const snapshot: SettleCheckSnapshot = {
      queues: queueDepths,
      mailOutboxPending,
      deadLetterTotal,
    };
    const evaluation = evaluateSettleCheck(snapshot);

    console.log(
      formatSettleCheckReport({
        snapshot,
        evaluation,
        elapsedMilliseconds: performance.now() - startedAt,
        timedOut,
      }),
    );
    console.log('\nWorker heartbeats (last completed job):');
    for (const heartbeat of heartbeats) {
      console.log(`  ${heartbeat.queue}: ${heartbeat.last_job_at ?? 'none in last 24h'}`);
    }

    process.exitCode = evaluation.passed ? 0 : 1;
  } finally {
    await Promise.allSettled(queues.map((queue) => queue.close()));
    await closeBullMqRedis();
    await closeRedis();
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error('settle-check failed:', error);
  process.exitCode = 1;
});
