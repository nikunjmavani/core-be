import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { getEnv } from '@/shared/config/env.config.js';
import {
  isMetricsEnabled,
  refreshMetricsBeforeScrape,
  renderMetrics,
} from '@/infrastructure/observability/metrics/metrics.js';
import { isBearerTokenValid } from '@/shared/utils/security/bearer-token.util.js';

const metricsMiddleware: FastifyPluginAsync = async (application) => {
  if (!isMetricsEnabled()) {
    return;
  }

  application.get('/metrics', { config: { raw_response: true } }, async (request, reply) => {
    const environment = getEnv();
    const bearerToken = environment.METRICS_SCRAPE_TOKEN;
    if (!(bearerToken && isBearerTokenValid(request.headers.authorization, bearerToken))) {
      throw new UnauthorizedError('errors:invalidMetricsToken');
    }

    await refreshMetricsBeforeScrape();
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return renderMetrics();
  });
};

export default metricsMiddleware;
