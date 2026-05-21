import { describe, expect, it } from 'vitest';
import {
  isWorkerThroughputStalled,
  type WorkerQueueHeartbeat,
} from '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js';

describe('worker-queue-heartbeat', () => {
  const nowMs = Date.parse('2026-05-19T12:00:00.000Z');
  const stallTimeoutMs = 300_000;

  it('isWorkerThroughputStalled returns false when no heartbeats exist yet', () => {
    const heartbeats: WorkerQueueHeartbeat[] = [
      { queue: 'mail', last_job_at: null },
      { queue: 'webhook-delivery', last_job_at: null },
    ];
    expect(isWorkerThroughputStalled(heartbeats, stallTimeoutMs, nowMs)).toBe(false);
  });

  it('isWorkerThroughputStalled returns false when at least one queue completed recently', () => {
    const heartbeats: WorkerQueueHeartbeat[] = [
      { queue: 'mail', last_job_at: '2026-05-19T11:58:00.000Z' },
      { queue: 'webhook-delivery', last_job_at: '2026-05-19T11:50:00.000Z' },
    ];
    expect(isWorkerThroughputStalled(heartbeats, stallTimeoutMs, nowMs)).toBe(false);
  });

  it('isWorkerThroughputStalled returns true when all recorded heartbeats are stale', () => {
    const heartbeats: WorkerQueueHeartbeat[] = [
      { queue: 'mail', last_job_at: '2026-05-19T11:00:00.000Z' },
      { queue: 'webhook-delivery', last_job_at: '2026-05-19T10:30:00.000Z' },
    ];
    expect(isWorkerThroughputStalled(heartbeats, stallTimeoutMs, nowMs)).toBe(true);
  });
});
