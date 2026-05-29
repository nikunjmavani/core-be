import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import { env } from '@/shared/config/env.config.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';

/**
 * Liveness/readiness probe paths bypassed by the global limiter. Matched by exact
 * path equality (query string stripped) so deploy probes and load balancers are never
 * throttled, while arbitrary paths sharing a prefix (e.g. `/livezxyz`) are not exempt.
 */
const RATE_LIMIT_ALLOWLISTED_PATHS = new Set(['/livez', '/readyz']);

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
 *
 * @remarks
 * **Fail-open on Redis store error (`skipOnError: true`).** The shared Redis client uses
 * `enableOfflineQueue: false`, so during a Redis blip (failover, maintenance, brief network
 * partition) `store.incr` rejects immediately. Without `skipOnError`, `@fastify/rate-limit`
 * rethrows that error from the `onRequest` hook, turning every single request — including
 * `/livez` / `/readyz` allow-list bypasses below the hook chain — into a 5xx and taking the API down.
 *
 * The deliberate trade-off is **availability over rate-limit enforcement during partial
 * outages**: a few seconds of unmetered traffic is preferable to a blanket outage. Defense
 * in depth is preserved by (1) the per-route auth-gated presets, (2) the Redis client's
 * `error` event handler which logs `redis.connection.error` for alerting, and (3) the
 * idempotency middleware which intentionally fail-closes for write safety.
 *
 * Wrapped with `fastify-plugin` so `@fastify/rate-limit` decorates the root app rather than an
 * encapsulated child context. This is required for two reasons: (1) the `global: true` limiter's
 * `onRequest` hook must apply to every route (and run before `organizationRlsTransactionMiddleware`
 * so throttled requests never open a DB transaction), and (2) per-route presets that build a second
 * limiter via `app.rateLimit(...)` (e.g. the per-email throttle in `auth.routes.ts`) need the
 * `rateLimit` decorator visible at the instance where routes register.
 */
const rateLimitMiddleware: FastifyPluginAsync = async (app) => {
  const plugin = fastifyRateLimit as unknown as FastifyPluginAsync<RateLimitPluginOptions>;

  const options: RateLimitPluginOptions = {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    // Exact-match the liveness/readiness probe paths so unmetered bypass cannot be
    // smuggled via a prefix collision like `/healthxyz` (the old `startsWith('/health')`).
    allowList: (request) => RATE_LIMIT_ALLOWLISTED_PATHS.has(request.url.split('?', 1)[0] ?? ''),
    keyGenerator: (request) => request.ip,
    // Fail-open on store unavailability — see @remarks above. The Redis client's `error`
    // event handler still surfaces the underlying issue for on-call.
    skipOnError: true,
  };

  // Use Redis when configured; chaos suite sets RUN_REDIS_TESTS=0 for in-memory limiting.
  if (env.REDIS_URL && process.env.RUN_REDIS_TESTS !== '0') {
    options.redis = redisConnection as unknown as RateLimitPluginOptions['redis'];
  }

  await app.register(plugin, options);
};

export default fp(rateLimitMiddleware, { name: 'rate-limit-middleware' });
