import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import { env } from '@/shared/config/env.config.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';

/**
 * Global rate limiting, keyed strictly on `request.ip`.
 *
 * This limiter runs in the `onRequest` phase, before route authentication (which happens
 * in a later `preHandler` via `app.authenticate`). The only tenant signal available here is
 * the request-asserted `X-Organization-Id` header/path, which is NOT yet verified against
 * the caller's membership. Keying on that value would let an unauthenticated client rotate a
 * fresh org id per request to mint a new bucket (bypassing the per-IP cap) or reuse a victim
 * org's id to burn its shared bucket (cross-tenant throttling). It is therefore IP-only.
 *
 * Org- and user-scoped quotas are applied per route in a post-auth `preHandler` via the
 * presets in `rate-limit-presets.constants.ts` (e.g. `ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT`),
 * where `request.auth` and route authorization gate access before the key is derived.
 */
const rateLimitMiddleware: FastifyPluginAsync = async (app) => {
  const plugin = fastifyRateLimit as unknown as FastifyPluginAsync<RateLimitPluginOptions>;

  const options: RateLimitPluginOptions = {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    allowList: (request) => request.url.startsWith('/health'),
    keyGenerator: (request) => request.ip,
  };

  // Use Redis when configured; chaos suite sets RUN_REDIS_TESTS=0 for in-memory limiting.
  if (env.REDIS_URL && process.env.RUN_REDIS_TESTS !== '0') {
    options.redis = redisConnection as unknown as RateLimitPluginOptions['redis'];
  }

  await app.register(plugin, options);
};

export default rateLimitMiddleware;
