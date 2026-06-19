import { describe, expect, it } from 'vitest';
import {
  isWorkerStalled,
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

describe('isWorkerStalled (queue-depth-aware readiness — EX-02)', () => {
  // Bug premise: a stale heartbeat alone used to mark the worker stalled. With queue depth in the
  // decision, an idle worker (stale heartbeat, empty queue) is healthy; only a backlog with dead
  // throughput is stalled.
  it('is NOT stalled when heartbeats are stale but no jobs are waiting (idle worker — the fix)', () => {
    expect(isWorkerStalled({ isThroughputStalled: true, waitingJobCount: 0 })).toBe(false);
  });

  it('IS stalled when heartbeats are stale and jobs are waiting (genuinely stuck)', () => {
    expect(isWorkerStalled({ isThroughputStalled: true, waitingJobCount: 5 })).toBe(true);
  });

  it('is NOT stalled when throughput is healthy, regardless of waiting jobs', () => {
    expect(isWorkerStalled({ isThroughputStalled: false, waitingJobCount: 5 })).toBe(false);
  });
});
