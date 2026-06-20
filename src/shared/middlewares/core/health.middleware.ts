import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { getWorkerQueueOperationalManifest } from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';
import { isApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import { getCachedHealthOperationalMetrics } from '@/shared/utils/infrastructure/health-operational-metrics.util.js';
import { getCachedDependencyReadinessProbes } from '@/shared/utils/infrastructure/readiness-probes.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

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
      worker_queue_manifest: getWorkerQueueOperationalManifest(),
      circuit_breakers: [],
      queue_depths: [],
      degraded: false,
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

  // sec-C4: the verbose operational body (`migration_version`,
  // `mail_outbox_pending`, `dlq_depth`, `worker_queue_manifest`) is useful
  // for internal probes but is reconnaissance for unauthenticated callers:
  // migration version reveals patch level; DLQ depth signals "platform
  // reeling"; the manifest reveals worker topology. Default OFF; operators
  // explicitly opt in via `HEALTH_VERBOSE_BODY_ENABLED=true` for trusted
  // ingress paths (LB-internal probes behind network ACLs).
  // Operational metrics (breaker state + queue depth) are needed to render the verbose body OR to
  // evaluate the opt-in 503 thresholds; otherwise the hot path stays at just the dependency probes.
  const optInChecksEnabled =
    env.READYZ_503_ON_OPEN_CIRCUIT || env.READYZ_QUEUE_DEPTH_503_THRESHOLD > 0;
  const needOperational = env.HEALTH_VERBOSE_BODY_ENABLED || optInChecksEnabled;

  const [readiness, operational] = await Promise.all([
    getCachedDependencyReadinessProbes(),
    needOperational ? getOperationalMetricsForReadiness() : Promise.resolve(null),
  ]);

  // Postgres/Redis/BullMQ always gate readiness. External breaker state / queue depth are
  // informational by default (reported as `degraded`); operators may OPT IN to also 503 on them
  // so an email/storage blip does not pull the whole API out of load-balancer rotation by default.
  let shouldFail = readiness.status !== 'ok';
  if (operational && optInChecksEnabled) {
    if (env.READYZ_503_ON_OPEN_CIRCUIT && operational.degraded) {
      shouldFail = true;
    }
    if (
      env.READYZ_QUEUE_DEPTH_503_THRESHOLD > 0 &&
      operational.queue_depths.some((depth) => depth.waiting > env.READYZ_QUEUE_DEPTH_503_THRESHOLD)
    ) {
      shouldFail = true;
    }
  }
  if (shouldFail) {
    reply.status(503);
  }

  return env.HEALTH_VERBOSE_BODY_ENABLED && operational
    ? { ...readiness, ...operational }
    : readiness;
}

/**
 * Health endpoints (all return raw JSON, no response envelope):
 *
 * | Path | Purpose |
 * | ---- | ------- |
 * | `GET /livez` | Liveness — process/event loop responsive; no dependency probes. 503 only while draining. |
 * | `GET /readyz` | Readiness — Postgres, Redis, BullMQ broker reachable from this process (cached). |
 *
 * Liveness (`/livez`) backs the container `HEALTHCHECK` so a healthy-but-not-yet-ready
 * process is not killed during dependency warm-up; readiness (`/readyz`) backs deploy
 * gating and load-balancer routing. Readiness results are cached for a short window
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
};

export default healthMiddleware;
