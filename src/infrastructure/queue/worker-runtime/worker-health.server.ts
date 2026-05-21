import http from 'node:http';
import {
  isMetricsEnabled,
  refreshMetricsBeforeScrape,
  renderMetrics,
} from '@/infrastructure/observability/metrics/metrics.js';
import { env, getEnv } from '@/shared/config/env.config.js';
import { isBearerTokenValid } from '@/shared/utils/security/bearer-token.util.js';
import { MONITORED_BULLMQ_QUEUE_NAMES } from '@/infrastructure/observability/metrics/bullmq-metrics.js';
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

export function markWorkerHealthReady(workerCount?: number): void {
  workerReady = true;
  if (workerCount !== undefined) {
    registeredWorkerCount = workerCount;
  }
}

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

async function handleLiveProbe(response: http.ServerResponse): Promise<void> {
  if (!workerReady) {
    sendJson(response, 503, { status: 'starting', service: 'worker' });
    return;
  }

  const throughputHeartbeats = await readWorkerQueueHeartbeats(WORKER_THROUGHPUT_QUEUE_NAMES);
  const stalled = isWorkerThroughputStalled(
    throughputHeartbeats,
    env.WORKER_HEALTH_STALL_TIMEOUT_MS,
  );

  if (stalled) {
    sendJson(response, 503, { status: 'stalled', service: 'worker' });
    return;
  }

  sendJson(response, 200, { status: 'ok', service: 'worker' });
}

async function handleWorkerProbe(response: http.ServerResponse): Promise<void> {
  const [readiness, worker_queues] = await Promise.all([
    runDependencyReadinessProbes(),
    readWorkerQueueHeartbeats(MONITORED_BULLMQ_QUEUE_NAMES),
  ]);
  const processReady = workerReady && readiness.status === 'ok';
  sendJson(response, processReady ? 200 : 503, {
    ...readiness,
    status: processReady ? 'ok' : readiness.status === 'ok' ? 'starting' : readiness.status,
    role: 'worker',
    workersRegistered: registeredWorkerCount,
    worker_queues,
  });
}

async function handleAggregateHealth(response: http.ServerResponse): Promise<void> {
  const readiness = await runDependencyReadinessProbes();
  const processReady = workerReady && readiness.status === 'ok';
  sendJson(response, processReady ? 200 : 503, {
    status: processReady ? 'ok' : 'starting',
    live: workerReady ? 'ok' : 'starting',
    database: readiness.database,
    redis: readiness.redis,
    bullmq: readiness.bullmq,
    latencyMs: readiness.latencyMs,
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

  if (url === '/health/live') {
    await handleLiveProbe(response);
    return;
  }
  if (url === '/health/worker') {
    await handleWorkerProbe(response);
    return;
  }
  if (url === '/health') {
    await handleAggregateHealth(response);
    return;
  }
  if (url === '/metrics' && isMetricsEnabled()) {
    await handleMetrics(request, response);
    return;
  }

  response.writeHead(404);
  response.end();
}

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
