import { describe, it, expect, afterAll } from 'vitest';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';

const NOOP_QUEUE_NAME = 'test-noop-smoke';

describe('Integration: BullMQ noop job smoke', () => {
  let worker: Worker | null = null;
  let queue: Queue | null = null;
  let queueEvents: QueueEvents | null = null;

  afterAll(async () => {
    if (worker) await worker.close();
    if (queueEvents) await queueEvents.close();
    if (queue) await queue.close();
  });

  it('should enqueue and process a noop job end-to-end', async () => {
    const connection = getBullMQConnectionOptions();
    let processedPayload: { ping: string } | null = null;

    queue = new Queue(NOOP_QUEUE_NAME, { connection });
    queueEvents = new QueueEvents(NOOP_QUEUE_NAME, { connection });
    worker = new Worker<{ ping: string }>(
      NOOP_QUEUE_NAME,
      async (job) => {
        processedPayload = job.data;
      },
      { connection },
    );

    const job = await queue.add('noop', { ping: 'pong' }, { removeOnComplete: true });
    await job.waitUntilFinished(queueEvents);

    expect(processedPayload).toEqual({ ping: 'pong' });
  }, 30_000);
});
