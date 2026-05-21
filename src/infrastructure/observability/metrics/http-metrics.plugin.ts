import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { isMetricsEnabled } from '@/infrastructure/observability/metrics/metrics-registry.js';
import { recordHttpRequest } from '@/infrastructure/observability/metrics/prometheus-metrics.js';

function resolveRouteLabel(url: string, routePattern: string | undefined): string {
  if (routePattern && routePattern.length > 0) {
    return routePattern;
  }
  const pathOnly = url.split('?')[0] ?? url;
  return pathOnly;
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
    const routeLabel = resolveRouteLabel(request.url, request.routeOptions?.url);
    recordHttpRequest(request.method, routeLabel, reply.statusCode, durationSeconds);
  });
};

export default fp(httpMetricsPlugin, { name: 'http-metrics-plugin' });
