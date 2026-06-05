import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { isMetricsEnabled } from '@/infrastructure/observability/metrics/metrics-registry.js';
import { recordHttpRequest } from '@/infrastructure/observability/metrics/prometheus-metrics.js';

/**
 * Sentinel value used for the Prometheus `route` label when Fastify did not match a route
 * (i.e. 404). Collapsing every unmatched URL into one series prevents the registry from
 * growing unbounded as anonymous attackers spray unique paths. See sec-C2.
 */
const UNMATCHED_ROUTE_LABEL = '__unmatched__';

/**
 * Picks the Prometheus `route` label.
 *
 * @remarks
 * - When Fastify matched a route, uses the parameterized pattern (e.g. `/users/:id`) — bounded
 *   by the registered route table, safe cardinality.
 * - When no route matched (404), uses the constant {@link UNMATCHED_ROUTE_LABEL} so a flood of
 *   distinct 404 paths collapses into a single time-series instead of inflating the registry.
 *   Without this, `/random/<uuid>` attacks could OOM the `/metrics` scrape (sec-C2).
 */
function resolveRouteLabel(routePattern: string | undefined): string {
  if (routePattern && routePattern.length > 0) {
    return routePattern;
  }
  return UNMATCHED_ROUTE_LABEL;
}

const httpMetricsPlugin: FastifyPluginAsync = async (application) => {
  if (!isMetricsEnabled()) {
    return;
  }

  application.addHook('onRequest', async (request) => {
    request.metricsStartTimeNanoseconds = process.hrtime.bigint();
  });

  application.addHook('onResponse', async (request, reply) => {
    const startedAt = request.metricsStartTimeNanoseconds;
    if (startedAt === undefined) {
      return;
    }
    const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
    const durationSeconds = Number(elapsedNanoseconds) / 1_000_000_000;
    const routeLabel = resolveRouteLabel(request.routeOptions?.url);
    recordHttpRequest(request.method, routeLabel, reply.statusCode, durationSeconds);
  });
};

export default fp(httpMetricsPlugin, { name: 'http-metrics-plugin' });
