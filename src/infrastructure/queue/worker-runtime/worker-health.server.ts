import http from 'node:http';
import {
  isMetricsEnabled,
  refreshMetricsBeforeScrape,
  renderMetrics,
} from '@/infrastructure/observability/metrics/metrics.js';
import { env, getEnv } from '@/shared/config/env.config.js';
import { isBearerTokenValid } from '@/shared/utils/security/bearer-token.util.js';
import {
  MONITORED_BULLMQ_QUEUE_NAMES,
  readQueuesPendingWorkTotal,
} from '@/infrastructure/observability/metrics/bullmq-metrics.js';
import {
  isWorkerThroughputStalled,
  readWorkerQueueHeartbeats,
  WORKER_THROUGHPUT_QUEUE_NAMES,
} from '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js';
import { runDependencyReadinessProbes } from '@/shared/utils/infrastructure/readiness-probes.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

let healthServer: http.Server | null = null;
let workerReady = false;
let registeredWorkerCount = 0;

/**
 * Flips the `/readyz` probe from `starting` to ready once every worker is registered.
 * `workerCount` is reflected back as `workersRegistered` in the probe response so
 * deployment automation can confirm the expected fleet size has bound to BullMQ.
 */
export function markWorkerHealthReady(workerCount?: number): void {
  workerReady = true;
  if (workerCount !== undefined) {
    registeredWorkerCount = workerCount;
  }
}

/** Marks the process unready (graceful shutdown begins) so load balancers stop sending traffic. */
export function markWorkerHealthNotReady(): void {
  workerReady = false;
}

function resolveAuthorizationHeader(
  authorizationHeader: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(authorizationHeader)) {
    return authorizationHeader[0];
  }
  return authorizationHeader;
}

function authorizeMetricsRequest(authorizationHeader: string | string[] | undefined): boolean {
  const resolvedAuthorizationHeader = resolveAuthorizationHeader(authorizationHeader);
  const environment = getEnv();
  const bearerToken = environment.METRICS_SCRAPE_TOKEN;
  if (environment.NODE_ENV === 'production' && environment.METRICS_ENABLED) {
    return Boolean(bearerToken && isBearerTokenValid(resolvedAuthorizationHeader, bearerToken));
  }
  if (bearerToken) {
    return isBearerTokenValid(resolvedAuthorizationHeader, bearerToken);
  }
  return true;
}

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function resolveWorkerHealthStatus({
  isReady,
  isStalled,
  dependencyStatus,
}: {
  isReady: boolean;
  isStalled: boolean;
  dependencyStatus: string;
}): string {
  if (!isReady) return 'starting';
  if (isStalled) return 'stalled';
  return dependencyStatus;
}

/**
 * Liveness: the process and its HTTP server are responsive. Runs no dependency probes and is
 * independent of worker registration, so a healthy-but-still-warming-up worker is not killed.
 */
function handleLivenessProbe(response: http.ServerResponse): void {
  sendJson(response, 200, { status: 'live', role: 'worker' });
}

async function handleReadinessProbe(response: http.ServerResponse): Promise<void> {
  const [readiness, worker_queues, throughputHeartbeats, throughputPendingWork] = await Promise.all(
    [
      runDependencyReadinessProbes(),
      readWorkerQueueHeartbeats(MONITORED_BULLMQ_QUEUE_NAMES),
      readWorkerQueueHeartbeats(WORKER_THROUGHPUT_QUEUE_NAMES),
      readQueuesPendingWorkTotal(WORKER_THROUGHPUT_QUEUE_NAMES),
    ],
  );
  // Only treat stale throughput heartbeats as a stall when there is actually pending work to
  // drain; an idle worker with an empty queue (quiet periods, cron-only workers) is healthy.
  const stalled = isWorkerThroughputStalled(
    throughputHeartbeats,
    env.WORKER_HEALTH_STALL_TIMEOUT_MS,
    Date.now(),
    throughputPendingWork,
  );
  const processReady = workerReady && !stalled && readiness.status === 'ok';
  const status = resolveWorkerHealthStatus({
    isReady: workerReady,
    isStalled: stalled,
    dependencyStatus: readiness.status,
  });

  sendJson(response, processReady ? 200 : 503, {
    status,
    role: 'worker',
    database: readiness.database,
    redis: readiness.redis,
    bullmq: readiness.bullmq,
    latencyMs: readiness.latencyMs,
    workersRegistered: registeredWorkerCount,
    worker_queues,
  });
}

async function handleMetrics(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  if (!authorizeMetricsRequest(request.headers.authorization)) {
    sendJson(response, 401, { status: 'error', detail: 'Invalid metrics bearer token' });
    return;
  }
  await refreshMetricsBeforeScrape();
  const body = await renderMetrics();
  response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  response.end(body);
}

async function handleHealthRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: string,
): Promise<void> {
  if (request.method !== 'GET') {
    response.writeHead(404);
    response.end();
    return;
  }

  if (url === '/livez') {
    handleLivenessProbe(response);
    return;
  }
  if (url === '/readyz') {
    await handleReadinessProbe(response);
    return;
  }
  if (url === '/metrics' && isMetricsEnabled()) {
    await handleMetrics(request, response);
    return;
  }

  response.writeHead(404);
  response.end();
}

/**
 * Boots a lightweight Node HTTP server (no Fastify) exposing `/livez` (liveness), `/readyz`
 * (readiness — deps + worker registration + stall) and (when metrics are enabled) `/metrics`
 * on `WORKER_HEALTH_PORT`. Idempotent — subsequent calls are no-ops while the server is
 * already listening. Listens on `HTTP_BIND_HOST` so the same binding rules as the API apply.
 * `/metrics` is gated by `METRICS_SCRAPE_TOKEN` (required in production when metrics are enabled).
 */
export async function startWorkerHealthServer(): Promise<void> {
  if (healthServer) return;

  const port = env.WORKER_HEALTH_PORT;

  healthServer = http.createServer((request, response) => {
    const url = request.url?.split('?')[0] ?? '';
    void handleHealthRequest(request, response, url).catch((error) => {
      logger.error({ error, url }, 'worker.health.request.failed');
      if (!response.headersSent) {
        sendJson(response, 500, { status: 'error' });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    healthServer?.once('error', reject);
    healthServer?.listen(port, env.HTTP_BIND_HOST, () => resolve());
  });

  logger.info({ port, host: env.HTTP_BIND_HOST }, 'worker.health.server.started');
}

/**
 * Stops the worker health/metrics HTTP server and resets the readiness counters so the
 * process can be safely restarted in-place (e.g. during integration tests). No-op when
 * the server is not running.
 */
export async function stopWorkerHealthServer(): Promise<void> {
  if (!healthServer) return;

  const server = healthServer;
  healthServer = null;
  workerReady = false;
  registeredWorkerCount = 0;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  logger.info('worker.health.server.stopped');
}
