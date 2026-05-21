import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import { env } from '@/shared/config/env.config.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';

const rateLimitMiddleware: FastifyPluginAsync = async (app) => {
  const plugin = fastifyRateLimit as unknown as FastifyPluginAsync<RateLimitPluginOptions>;

  const options: RateLimitPluginOptions = {
    global: true,
    max: async (request) => {
      if (request.organizationId) {
        return env.RATE_LIMIT_ORG_MAX;
      }
      return env.RATE_LIMIT_MAX;
    },
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    allowList: (request) => request.url.startsWith('/health'),
    keyGenerator: (request) => {
      if (request.organizationId) {
        return `org:${request.organizationId}`;
      }
      return request.ip;
    },
  };

  // Use Redis when configured; chaos suite sets RUN_REDIS_TESTS=0 for in-memory limiting.
  if (env.REDIS_URL && process.env.RUN_REDIS_TESTS !== '0') {
    options.redis = redisConnection as unknown as RateLimitPluginOptions['redis'];
  }

  await app.register(plugin, options);
};

export default rateLimitMiddleware;
