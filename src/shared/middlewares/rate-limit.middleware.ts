import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import { env } from '@/shared/config/env.config.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';

/**
 * Global rate limiting.
 *
 * Org-scoped keying/quota depend on `request.organizationId`, which is set by
 * `tenant.middleware`. This plugin MUST therefore be registered AFTER tenant middleware
 * (see the ordering in `middlewares/index.ts`) — otherwise `organizationId` is still null
 * in the `onRequest` phase and every org request silently falls back to per-IP limits.
 *
 * Note: the org context here is request-asserted (header/path), not yet authenticated —
 * route auth runs in a later `preHandler` phase. This matches how the RLS GUC is set, and
 * abuse is bounded by `RATE_LIMIT_ORG_MAX`. Gating org-keyed quotas behind authenticated
 * membership would require moving rate limiting into a post-auth preHandler (future work).
 */
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
