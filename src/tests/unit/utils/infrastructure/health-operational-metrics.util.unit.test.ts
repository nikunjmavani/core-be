import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLatestMigrationVersionMock = vi.hoisted(() => vi.fn());
const countPendingMailOutboxMock = vi.hoisted(() => vi.fn());
const getTotalDeadLetterJobCountMock = vi.hoisted(() => vi.fn());
const readWorkerQueueHeartbeatsMock = vi.hoisted(() => vi.fn());
const snapshotManagedCircuitBreakersMock = vi.hoisted(() => vi.fn());
const getQueueDepthsMock = vi.hoisted(() => vi.fn());
const isApplicationDrainingMock = vi.hoisted(() => vi.fn());
const getWorkerQueueOperationalManifestMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/migration/migration-version.js', () => ({
  getLatestMigrationVersion: getLatestMigrationVersionMock,
}));
vi.mock('@/infrastructure/mail/mail-outbox.repository.js', () => ({
  countPendingMailOutbox: countPendingMailOutboxMock,
}));
vi.mock('@/infrastructure/observability/dlq-depth/dlq-depth.service.js', () => ({
  getTotalDeadLetterJobCount: getTotalDeadLetterJobCountMock,
}));
vi.mock('@/infrastructure/observability/metrics/bullmq-metrics.js', () => ({
  getQueueDepths: getQueueDepthsMock,
  MONITORED_BULLMQ_QUEUE_NAMES: ['mail'],
}));
vi.mock('@/infrastructure/queue/worker-runtime/worker-registration.registry.js', () => ({
  getWorkerQueueOperationalManifest: getWorkerQueueOperationalManifestMock,
}));
vi.mock('@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js', () => ({
  readWorkerQueueHeartbeats: readWorkerQueueHeartbeatsMock,
  WORKER_THROUGHPUT_QUEUE_NAMES: ['mail'],
}));
vi.mock('@/infrastructure/resilience/circuit-breaker.js', () => ({
  snapshotManagedCircuitBreakers: snapshotManagedCircuitBreakersMock,
}));
vi.mock('@/shared/utils/infrastructure/application-lifecycle.util.js', () => ({
  isApplicationDraining: isApplicationDrainingMock,
}));

import {
  getCachedHealthOperationalMetrics,
  resetHealthOperationalMetricsCacheForTests,
} from '@/shared/utils/infrastructure/health-operational-metrics.util.js';

/**
 * `/readyz` operational metrics and their 60-second cache.
 *
 * @remarks
 * `resetHealthOperationalMetricsCacheForTests` is exported *for tests*, and no test used it — which
 * meant the caching it exists to reset was itself unverified. That cache is not a nicety: `/readyz`
 * is polled continuously by load balancers and orchestrators, and each miss fans out to Postgres,
 * Redis, and every queue. Losing the cache would multiply that by the probe rate.
 *
 * The other property worth pinning is `degraded`: it summarises the external circuit breakers, and
 * its documented contract is that it is informational — an OPEN breaker must NOT by itself make the
 * process look unready, or one flaky third party would pull healthy instances out of rotation.
 */
function stubUpstreams(): void {
  getLatestMigrationVersionMock.mockResolvedValue('20260401120000');
  countPendingMailOutboxMock.mockResolvedValue(3);
  getTotalDeadLetterJobCountMock.mockResolvedValue(0);
  readWorkerQueueHeartbeatsMock.mockResolvedValue([{ queue: 'mail', last_seen_at: null }]);
  snapshotManagedCircuitBreakersMock.mockResolvedValue([{ name: 'stripe', state: 'CLOSED' }]);
  getQueueDepthsMock.mockResolvedValue([{ queue: 'mail', waiting: 0, delayed: 0 }]);
  getWorkerQueueOperationalManifestMock.mockReturnValue([{ queue: 'mail' }]);
  isApplicationDrainingMock.mockReturnValue(false);
}

describe('getCachedHealthOperationalMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    resetHealthOperationalMetricsCacheForTests();
    stubUpstreams();
  });

  it('collects a snapshot from every upstream', async () => {
    const metrics = await getCachedHealthOperationalMetrics();

    expect(metrics).toMatchObject({
      migration_version: '20260401120000',
      mail_outbox_pending: 3,
      dlq_depth: 0,
      draining: false,
    });
  });

  it('serves a second call from cache without re-querying', async () => {
    // The whole point: /readyz is polled continuously, and every miss fans out to Postgres, Redis
    // and each queue.
    await getCachedHealthOperationalMetrics();
    await getCachedHealthOperationalMetrics();

    expect(countPendingMailOutboxMock).toHaveBeenCalledTimes(1);
    expect(getTotalDeadLetterJobCountMock).toHaveBeenCalledTimes(1);
    expect(getQueueDepthsMock).toHaveBeenCalledTimes(1);
  });

  it('returns the identical cached object on a hit', async () => {
    const first = await getCachedHealthOperationalMetrics();
    const second = await getCachedHealthOperationalMetrics();

    expect(second).toBe(first);
  });

  it('re-queries once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));
    resetHealthOperationalMetricsCacheForTests();

    await getCachedHealthOperationalMetrics();
    // Just past the 60-second window.
    vi.setSystemTime(new Date('2026-04-01T12:01:01.000Z'));
    await getCachedHealthOperationalMetrics();

    expect(countPendingMailOutboxMock).toHaveBeenCalledTimes(2);
  });

  it('still serves from cache just inside the TTL', async () => {
    // The boundary from the other side: a cache that expired early would defeat its own purpose.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));
    resetHealthOperationalMetricsCacheForTests();

    await getCachedHealthOperationalMetrics();
    vi.setSystemTime(new Date('2026-04-01T12:00:59.000Z'));
    await getCachedHealthOperationalMetrics();

    expect(countPendingMailOutboxMock).toHaveBeenCalledTimes(1);
  });

  it('resetHealthOperationalMetricsCacheForTests forces the next call to re-query', async () => {
    await getCachedHealthOperationalMetrics();
    resetHealthOperationalMetricsCacheForTests();
    await getCachedHealthOperationalMetrics();

    expect(countPendingMailOutboxMock).toHaveBeenCalledTimes(2);
  });

  it('reports degraded when any external breaker is OPEN', async () => {
    snapshotManagedCircuitBreakersMock.mockResolvedValue([
      { name: 'stripe', state: 'CLOSED' },
      { name: 'resend', state: 'OPEN' },
    ]);

    expect((await getCachedHealthOperationalMetrics()).degraded).toBe(true);
  });

  it('does not report degraded when every breaker is closed or half-open', async () => {
    snapshotManagedCircuitBreakersMock.mockResolvedValue([
      { name: 'stripe', state: 'CLOSED' },
      { name: 's3', state: 'HALF_OPEN' },
    ]);

    // HALF_OPEN means recovery is being probed — treating it as degraded would keep an instance
    // flagged long after the dependency came back.
    expect((await getCachedHealthOperationalMetrics()).degraded).toBe(false);
  });

  it('does not report degraded when no breakers are registered', async () => {
    snapshotManagedCircuitBreakersMock.mockResolvedValue([]);

    expect((await getCachedHealthOperationalMetrics()).degraded).toBe(false);
  });

  it('keeps degraded separate from draining', async () => {
    // Documented contract: an OPEN breaker is informational and must not by itself make the
    // process look unready, or one flaky third party pulls healthy instances out of rotation.
    snapshotManagedCircuitBreakersMock.mockResolvedValue([{ name: 'stripe', state: 'OPEN' }]);
    isApplicationDrainingMock.mockReturnValue(false);

    const metrics = await getCachedHealthOperationalMetrics();

    expect(metrics.degraded).toBe(true);
    expect(metrics.draining).toBe(false);
  });

  it('reflects the draining flag at collection time', async () => {
    isApplicationDrainingMock.mockReturnValue(true);

    expect((await getCachedHealthOperationalMetrics()).draining).toBe(true);
  });

  it('propagates an upstream failure rather than caching a broken snapshot', async () => {
    // A cached failure would persist for the full TTL, so /readyz must fail loudly and retry on
    // the next probe instead.
    countPendingMailOutboxMock.mockRejectedValue(new Error('database unavailable'));

    await expect(getCachedHealthOperationalMetrics()).rejects.toThrow('database unavailable');

    countPendingMailOutboxMock.mockResolvedValue(3);
    await expect(getCachedHealthOperationalMetrics()).resolves.toMatchObject({
      mail_outbox_pending: 3,
    });
  });

  it('queries the upstreams concurrently', async () => {
    // Serialising six round trips would put the probe's latency over some readiness timeouts.
    let resolveMailOutbox: (value: number) => void = () => undefined;
    countPendingMailOutboxMock.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveMailOutbox = resolve;
        }),
    );

    const pending = getCachedHealthOperationalMetrics();
    await Promise.resolve();

    // Every other upstream was invoked without waiting for the slow one to settle.
    expect(getTotalDeadLetterJobCountMock).toHaveBeenCalled();
    expect(getQueueDepthsMock).toHaveBeenCalled();

    resolveMailOutbox(3);
    await pending;
  });
});
