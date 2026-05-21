import type { FastifyPluginAsync } from 'fastify';
import { isApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import { getCachedHealthOperationalMetrics } from '@/shared/utils/infrastructure/health-operational-metrics.util.js';
import { MONITORED_BULLMQ_QUEUE_NAMES } from '@/infrastructure/observability/metrics/bullmq-metrics.js';
import { readWorkerQueueHeartbeats } from '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js';
import { runDependencyReadinessProbes } from '@/shared/utils/infrastructure/readiness-probes.util.js';
import { applyDeprecatedEndpointHeaders } from '@/shared/utils/http/api-versioning.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Sunset for aggregate health routes superseded by `/health/live` and `/health/ready`. */
const AGGREGATE_HEALTH_SUNSET = new Date('2026-08-19T00:00:00.000Z');

async function getOperationalMetricsForReadiness() {
  try {
    return await getCachedHealthOperationalMetrics();
  } catch (error) {
    logger.warn({ error }, 'health.ready.operational_metrics_unavailable');
    return {
      migration_version: null,
      mail_outbox_pending: 0,
      dlq_depth: 0,
      draining: isApplicationDraining(),
      worker_queues: [],
    };
  }
}

/**
 * Health endpoints (all return raw JSON, no response envelope):
 *
 * | Path | Purpose |
 * | ---- | ------- |
 * | `GET /health/live` | Liveness — process is up (no dependency checks). |
 * | `GET /health/ready` | Readiness — Postgres, Redis, BullMQ broker reachable from this process. |
 * | `GET /health` | Aggregate — same dependency checks as `/health/ready` plus `live: ok`. |
 * | `GET /health/worker` | API view of worker **dependencies** (Redis + BullMQ + DB). Does not prove a worker replica is running; use the worker HTTP server `GET /health/worker` on `WORKER_HEALTH_PORT` (see worker-health-server.ts). |
 *
 * Deploy probes: Railway/API use `/health/live` + `/health/ready`. Worker replicas use `WORKER_HEALTH_PORT` (default 9090).
 */
const healthMiddleware: FastifyPluginAsync = async (application) => {
  application.get('/health/live', { config: { raw_response: true } }, async () => ({
    status: 'ok',
  }));

  application.get('/health/ready', { config: { raw_response: true } }, async (_request, reply) => {
    if (isApplicationDraining()) {
      reply.status(503);
      return {
        status: 'draining' as const,
        database: 'unavailable' as const,
        redis: 'unavailable' as const,
        bullmq: 'unavailable' as const,
        latencyMs: {
          database: null,
          redis: null,
          bullmq: null,
        },
      };
    }

    const [readiness, operational] = await Promise.all([
      runDependencyReadinessProbes(),
      getOperationalMetricsForReadiness(),
    ]);
    if (readiness.status !== 'ok') {
      reply.status(503);
    }
    return { ...readiness, ...operational };
  });

  application.get('/health', { config: { raw_response: true } }, async (_request, reply) => {
    applyDeprecatedEndpointHeaders(reply, {
      sunset: AGGREGATE_HEALTH_SUNSET,
      deprecation: true,
    });
    if (isApplicationDraining()) {
      reply.status(503);
      return {
        status: 'draining' as const,
        live: 'ok' as const,
        database: 'unavailable' as const,
        redis: 'unavailable' as const,
        bullmq: 'unavailable' as const,
        latencyMs: {
          database: null,
          redis: null,
          bullmq: null,
        },
      };
    }

    const readiness = await runDependencyReadinessProbes();
    const responsePayload = {
      status: readiness.status,
      live: 'ok' as const,
      database: readiness.database,
      redis: readiness.redis,
      bullmq: readiness.bullmq,
      latencyMs: readiness.latencyMs,
    };
    if (readiness.status !== 'ok') {
      reply.status(503);
    }
    return responsePayload;
  });

  application.get('/health/worker', { config: { raw_response: true } }, async (_request, reply) => {
    applyDeprecatedEndpointHeaders(reply, {
      sunset: AGGREGATE_HEALTH_SUNSET,
      deprecation: true,
    });
    const [readiness, worker_queues] = await Promise.all([
      runDependencyReadinessProbes(),
      readWorkerQueueHeartbeats(MONITORED_BULLMQ_QUEUE_NAMES),
    ]);
    const responsePayload = {
      status: readiness.status,
      role: 'api' as const,
      note: 'Validates worker dependencies from the API process. For worker replica liveness, probe WORKER_HEALTH_PORT/health/worker on the worker service.',
      database: readiness.database,
      redis: readiness.redis,
      bullmq: readiness.bullmq,
      latencyMs: readiness.latencyMs,
      worker_queues,
    };
    if (readiness.status !== 'ok') {
      reply.status(503);
    }
    return responsePayload;
  });
};

export default healthMiddleware;
