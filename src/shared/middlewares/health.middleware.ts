import type { FastifyPluginAsync } from 'fastify';
import { isApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import { getCachedHealthOperationalMetrics } from '@/shared/utils/infrastructure/health-operational-metrics.util.js';
import { runDependencyReadinessProbes } from '@/shared/utils/infrastructure/readiness-probes.util.js';
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

/**
 * Health endpoints (all return raw JSON, no response envelope):
 *
 * | Path | Purpose |
 * | ---- | ------- |
 * | `GET /health` | Readiness — Postgres, Redis, BullMQ broker reachable from this process. |
 *
 * Deploy probes: API and worker services each expose their own `/health` endpoint.
 */
const healthMiddleware: FastifyPluginAsync = async (application) => {
  application.get(
    '/health',
    {
      config: { raw_response: true },
      schema: {
        summary: 'Health check',
        description:
          'Returns 200 when the service is ready: Postgres, Redis, and BullMQ respond within timeouts. Returns 503 with per-dependency unavailable flags if any probe fails.',
        tags: ['Health'],
      },
    },
    async (_request, reply) => {
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
    },
  );
};

export default healthMiddleware;
