import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { isApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import { getCachedHealthOperationalMetrics } from '@/shared/utils/infrastructure/health-operational-metrics.util.js';
import { getCachedDependencyReadinessProbes } from '@/shared/utils/infrastructure/readiness-probes.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

async function getOperationalMetricsForReadiness() {
  try {
    return await getCachedHealthOperationalMetrics();
  } catch (error) {
    logger.warn({ error }, 'health.operational_metrics_unavailable');
    return {
      migration_version: null,
      mail_outbox_pending: 0,
      dlq_depth: 0,
      draining: isApplicationDraining(),
      worker_queues: [],
    };
  }
}

const RAW_RESPONSE_ROUTE_CONFIG = { config: { raw_response: true } } as const;

async function handleReadinessProbe(reply: FastifyReply) {
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
    getCachedDependencyReadinessProbes(),
    getOperationalMetricsForReadiness(),
  ]);
  if (readiness.status !== 'ok') {
    reply.status(503);
  }
  return { ...readiness, ...operational };
}

/**
 * Health endpoints (all return raw JSON, no response envelope):
 *
 * | Path | Purpose |
 * | ---- | ------- |
 * | `GET /livez` | Liveness — process/event loop responsive; no dependency probes. 503 only while draining. |
 * | `GET /readyz` | Readiness — Postgres, Redis, BullMQ broker reachable from this process (cached). |
 * | `GET /health` | Backward-compatible alias of `/readyz`. |
 *
 * Liveness (`/livez`) backs the container `HEALTHCHECK` so a healthy-but-not-yet-ready
 * process is not killed during dependency warm-up; readiness (`/readyz`, `/health`) backs
 * deploy gating and load-balancer routing. Readiness results are cached for a short window
 * (see `getCachedDependencyReadinessProbes`) to bound probe load.
 */
const healthMiddleware: FastifyPluginAsync = async (application) => {
  application.get(
    '/livez',
    {
      ...RAW_RESPONSE_ROUTE_CONFIG,
      schema: {
        summary: 'Liveness check',
        description:
          'Returns 200 when the process and event loop are responsive. Runs no dependency probes, so it stays cheap and is safe for the container liveness HEALTHCHECK. Returns 503 only while the process is draining during graceful shutdown.',
        tags: ['Health'],
      },
    },
    async (_request, reply) => {
      if (isApplicationDraining()) {
        reply.status(503);
        return { status: 'draining' as const };
      }
      return { status: 'ok' as const };
    },
  );

  application.get(
    '/readyz',
    {
      ...RAW_RESPONSE_ROUTE_CONFIG,
      schema: {
        summary: 'Readiness check',
        description:
          'Returns 200 when the service is ready: Postgres, Redis, and BullMQ respond within timeouts. Returns 503 with per-dependency unavailable flags if any probe fails or while draining. Results are cached briefly to bound probe load; used for deploy gating and load-balancer routing.',
        tags: ['Health'],
      },
    },
    async (_request, reply) => handleReadinessProbe(reply),
  );

  application.get(
    '/health',
    {
      ...RAW_RESPONSE_ROUTE_CONFIG,
      schema: {
        summary: 'Health check (readiness alias)',
        description:
          'Backward-compatible alias of GET /readyz. Returns 200 when Postgres, Redis, and BullMQ respond within timeouts, otherwise 503 with per-dependency unavailable flags. Prefer /readyz for readiness and /livez for liveness.',
        tags: ['Health'],
      },
    },
    async (_request, reply) => handleReadinessProbe(reply),
  );
};

export default healthMiddleware;
