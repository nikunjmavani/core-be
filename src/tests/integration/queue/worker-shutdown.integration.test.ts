import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';

import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';

describe('worker shutdown integration', () => {
  let queue: Queue | null = null;
  let worker: Worker | null = null;

  afterAll(async () => {
    await worker?.close(true);
    await queue?.close();
  });

  it('bounded worker.close drains within SHUTDOWN_TIMEOUT_MS default (15s)', async () => {
    const queueName = `worker-shutdown-drain-${randomUUID()}`;
    let processorCompletedAt = 0;

    const connection = getBullMQConnectionOptions();
    worker = new Worker(
      queueName,
      async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        processorCompletedAt = Date.now();
      },
      { connection, concurrency: 1 },
    );

    queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 5 },
      },
    });

    const handle = buildWorkerHandle(worker, queueName);
    await worker.waitUntilReady();
    await queue.waitUntilReady();
    await queue.add('drain', {});
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const closeStartedAt = Date.now();
    await handle.close();
    const closeFinishedAt = Date.now();

    expect(processorCompletedAt).toBeGreaterThan(0);
    expect(processorCompletedAt).toBeLessThanOrEqual(closeFinishedAt);
    expect(closeFinishedAt - closeStartedAt).toBeLessThan(15_000);
  });
});
