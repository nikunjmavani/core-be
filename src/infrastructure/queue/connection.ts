import { resolveRedisKeyPrefix } from '@/infrastructure/cache/redis-prefix.util.js';
import { parseRedisUrl, resolveBullMqRedisUrl } from '@/infrastructure/cache/redis-url.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

/**
 * Queue connection re-exports the shared Redis connection.
 * BullMQ uses REDIS_URL by default — see {@link getBullMQConnectionOptions}.
 */
export { redisConnection, closeRedis } from '@/infrastructure/cache/redis.client.js';
export {
  bullmqRedisConnection,
  closeBullMqRedis,
  connectBullMqRedis,
} from '@/infrastructure/cache/bullmq-redis.client.js';

/**
 * BullMQ connection options for use when creating Queue/Worker.
 * Uses REDIS_URL by default, with REDIS_BULLMQ_URL available as an explicit override.
 *
 * TLS is intentionally not configured: production traffic flows over Railway's
 * private network (`redis://*.railway.internal`), which is already isolated and
 * does not terminate `rediss://`. `family: 0` enables dual-stack DNS lookup so
 * IPv6-only private hostnames resolve correctly.
 */
export function getBullMQConnectionOptions(): {
  host: string;
  port: number;
  password?: string;
  db: number;
  family: number;
  maxRetriesPerRequest: null;
  prefix: string;
} {
  const bullMqRedisUrl = resolveBullMqRedisUrl();
  const parsed = parseRedisUrl(bullMqRedisUrl);
  return omitUndefined({
    host: parsed.host,
    port: parsed.port,
    password: parsed.password,
    db: parsed.databaseIndex,
    family: 0,
    maxRetriesPerRequest: null,
    prefix: resolveRedisKeyPrefix(),
  });
}
