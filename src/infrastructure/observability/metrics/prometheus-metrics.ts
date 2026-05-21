import { Counter, Gauge, Histogram, type Registry } from 'prom-client';
import {
  getMetricsRegistry,
  isMetricsEnabled,
} from '@/infrastructure/observability/metrics/metrics-registry.js';

let registeredMetricsRegistry: Registry | null = null;

let httpRequestsTotal: Counter<'method' | 'route' | 'status_code'> | null = null;
let httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_code'> | null = null;
let bullmqQueueWaiting: Gauge<'queue'> | null = null;
let bullmqQueueActive: Gauge<'queue'> | null = null;
let bullmqQueueDelayed: Gauge<'queue'> | null = null;
let bullmqQueueFailed: Gauge<'queue'> | null = null;
let bullmqJobDurationSeconds: Histogram<'queue' | 'job_name'> | null = null;
let postgresPoolMaxConnections: Gauge | null = null;
let postgresPoolMetricsAvailable: Gauge | null = null;
let dbPoolConnections: Gauge<'state'> | null = null;
let pgPoolActive: Gauge | null = null;
let pgPoolIdle: Gauge | null = null;
let pgPoolWaiting: Gauge | null = null;
let bullmqJobsWaiting: Gauge<'queue'> | null = null;
let eventLoopLagMilliseconds: Gauge | null = null;
let stripeWebhookEventsFailed: Gauge | null = null;

function registerOn(registry: Registry): void {
  httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  });

  httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  bullmqQueueWaiting = new Gauge({
    name: 'bullmq_queue_waiting',
    help: 'BullMQ jobs waiting in queue',
    labelNames: ['queue'],
    registers: [registry],
  });

  bullmqQueueActive = new Gauge({
    name: 'bullmq_queue_active',
    help: 'BullMQ jobs currently active',
    labelNames: ['queue'],
    registers: [registry],
  });

  bullmqQueueDelayed = new Gauge({
    name: 'bullmq_queue_delayed',
    help: 'BullMQ jobs delayed',
    labelNames: ['queue'],
    registers: [registry],
  });

  bullmqQueueFailed = new Gauge({
    name: 'bullmq_queue_failed',
    help: 'BullMQ jobs in failed state',
    labelNames: ['queue'],
    registers: [registry],
  });

  bullmqJobDurationSeconds = new Histogram({
    name: 'bullmq_job_duration_seconds',
    help: 'BullMQ job processing duration in seconds',
    labelNames: ['queue', 'job_name'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
    registers: [registry],
  });

  postgresPoolMaxConnections = new Gauge({
    name: 'postgres_pool_max_connections',
    help: 'Configured postgres.js pool max connections (DB_MAX)',
    registers: [registry],
  });

  postgresPoolMetricsAvailable = new Gauge({
    name: 'postgres_pool_metrics_available',
    help: '1 when live pool utilization metrics are exported; 0 when only config gauge is available (postgres.js limitation)',
    registers: [registry],
  });

  dbPoolConnections = new Gauge({
    name: 'db_pool_connections',
    help: 'Postgres connections for the current database user sampled from pg_stat_activity',
    labelNames: ['state'],
    registers: [registry],
  });

  pgPoolActive = new Gauge({
    name: 'pg_pool_active',
    help: 'Postgres connections in active state (alias of db_pool_connections{state="active"})',
    registers: [registry],
  });

  pgPoolIdle = new Gauge({
    name: 'pg_pool_idle',
    help: 'Postgres connections in idle state (alias of db_pool_connections{state="idle"})',
    registers: [registry],
  });

  pgPoolWaiting = new Gauge({
    name: 'pg_pool_waiting',
    help: 'Postgres connections waiting (alias of db_pool_connections{state="waiting"})',
    registers: [registry],
  });

  bullmqJobsWaiting = new Gauge({
    name: 'bullmq_jobs_waiting',
    help: 'BullMQ jobs waiting in queue (alias of bullmq_queue_waiting)',
    labelNames: ['queue'],
    registers: [registry],
  });

  eventLoopLagMilliseconds = new Gauge({
    name: 'event_loop_lag_ms',
    help: 'Node.js event loop delay p99 in milliseconds (perf_hooks.monitorEventLoopDelay)',
    registers: [registry],
  });

  stripeWebhookEventsFailed = new Gauge({
    name: 'stripe_webhook_events_failed',
    help: 'Stripe webhook ledger rows in failed processing_status (alert when >0 for >10m)',
    registers: [registry],
  });
}

function bindMetricHandlesFromRegistry(registry: Registry): void {
  httpRequestsTotal = registry.getSingleMetric('http_requests_total') as Counter<
    'method' | 'route' | 'status_code'
  >;
  httpRequestDurationSeconds = registry.getSingleMetric(
    'http_request_duration_seconds',
  ) as Histogram<'method' | 'route' | 'status_code'>;
  bullmqQueueWaiting = registry.getSingleMetric('bullmq_queue_waiting') as Gauge<'queue'>;
  bullmqQueueActive = registry.getSingleMetric('bullmq_queue_active') as Gauge<'queue'>;
  bullmqQueueDelayed = registry.getSingleMetric('bullmq_queue_delayed') as Gauge<'queue'>;
  bullmqQueueFailed = registry.getSingleMetric('bullmq_queue_failed') as Gauge<'queue'>;
  bullmqJobDurationSeconds = registry.getSingleMetric('bullmq_job_duration_seconds') as Histogram<
    'queue' | 'job_name'
  >;
  postgresPoolMaxConnections = registry.getSingleMetric('postgres_pool_max_connections') as Gauge;
  postgresPoolMetricsAvailable = registry.getSingleMetric(
    'postgres_pool_metrics_available',
  ) as Gauge;
  dbPoolConnections = registry.getSingleMetric('db_pool_connections') as Gauge<'state'>;
  pgPoolActive = registry.getSingleMetric('pg_pool_active') as Gauge;
  pgPoolIdle = registry.getSingleMetric('pg_pool_idle') as Gauge;
  pgPoolWaiting = registry.getSingleMetric('pg_pool_waiting') as Gauge;
  bullmqJobsWaiting = registry.getSingleMetric('bullmq_jobs_waiting') as Gauge<'queue'>;
  eventLoopLagMilliseconds = registry.getSingleMetric('event_loop_lag_ms') as Gauge;
  stripeWebhookEventsFailed = registry.getSingleMetric('stripe_webhook_events_failed') as Gauge;
  registeredMetricsRegistry = registry;
}

/**
 * Registers custom Prometheus metrics on the given registry.
 * Safe to call from scrape refresh and per-request recording (no circular import with metrics.ts).
 */
export function ensurePrometheusMetricsRegistered(registry: Registry): void {
  if (!isMetricsEnabled()) {
    return;
  }
  if (httpRequestsTotal && httpRequestDurationSeconds) {
    return;
  }
  if (registry.getSingleMetric('http_requests_total')) {
    bindMetricHandlesFromRegistry(registry);
    return;
  }
  registerOn(registry);
  registeredMetricsRegistry = registry;
}

export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number,
): void {
  if (!isMetricsEnabled()) return;
  ensurePrometheusMetricsRegistered(getMetricsRegistry());
  if (!(httpRequestsTotal && httpRequestDurationSeconds)) return;

  const labels = {
    method: method.toUpperCase(),
    route,
    status_code: String(statusCode),
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, durationSeconds);
}

export function setBullMQQueueCounts(
  queueName: string,
  counts: { waiting: number; active: number; delayed: number; failed: number },
): void {
  if (!isMetricsEnabled()) return;
  if (!(bullmqQueueWaiting && bullmqQueueActive && bullmqQueueDelayed && bullmqQueueFailed)) {
    return;
  }
  const label = { queue: queueName };
  bullmqQueueWaiting.set(label, counts.waiting);
  bullmqJobsWaiting?.set(label, counts.waiting);
  bullmqQueueActive.set(label, counts.active);
  bullmqQueueDelayed.set(label, counts.delayed);
  bullmqQueueFailed.set(label, counts.failed);
}

export function recordBullMQJobDuration(
  queueName: string,
  jobName: string,
  durationSeconds: number,
): void {
  if (!isMetricsEnabled()) return;
  const histogram =
    bullmqJobDurationSeconds ??
    (registeredMetricsRegistry?.getSingleMetric('bullmq_job_duration_seconds') as
      | Histogram<'queue' | 'job_name'>
      | undefined);
  if (!histogram) return;
  histogram.observe({ queue: queueName, job_name: jobName }, durationSeconds);
}

export function setPostgresPoolConfigMetrics(options: {
  maxConnections: number;
  liveMetricsAvailable: boolean;
}): void {
  if (!isMetricsEnabled()) return;
  if (!(postgresPoolMaxConnections && postgresPoolMetricsAvailable)) return;
  postgresPoolMaxConnections.set(options.maxConnections);
  postgresPoolMetricsAvailable.set(options.liveMetricsAvailable ? 1 : 0);
}

export function setPostgresPoolConnectionCounts(
  samples: ReadonlyArray<{ state: 'active' | 'idle' | 'waiting'; count: number }>,
): void {
  if (!isMetricsEnabled()) return;
  if (!dbPoolConnections) return;

  const countsByState: Record<'active' | 'idle' | 'waiting', number> = {
    active: 0,
    idle: 0,
    waiting: 0,
  };

  for (const sample of samples) {
    dbPoolConnections.set({ state: sample.state }, sample.count);
    countsByState[sample.state] = sample.count;
  }

  pgPoolActive?.set(countsByState.active);
  pgPoolIdle?.set(countsByState.idle);
  pgPoolWaiting?.set(countsByState.waiting);
}

export function setEventLoopLagMilliseconds(lagMilliseconds: number): void {
  if (!isMetricsEnabled()) return;
  ensurePrometheusMetricsRegistered(getMetricsRegistry());
  if (!eventLoopLagMilliseconds) return;
  eventLoopLagMilliseconds.set(lagMilliseconds);
}

export function setStripeWebhookEventsFailedCount(count: number): void {
  if (!isMetricsEnabled()) return;
  if (!stripeWebhookEventsFailed) return;
  stripeWebhookEventsFailed.set(count);
}
