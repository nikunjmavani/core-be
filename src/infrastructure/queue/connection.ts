import { resolveRedisKeyPrefix } from '@/infrastructure/cache/redis-prefix.util.js';
import {
  isRedisTlsUrl,
  parseRedisUrl,
  resolveBullMqRedisUrl,
} from '@/infrastructure/cache/redis-url.util.js';
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
 */
export function getBullMQConnectionOptions(): {
  host: string;
  port: number;
  password?: string;
  db: number;
  maxRetriesPerRequest: null;
  prefix: string;
  tls?: Record<string, never>;
} {
  const bullMqRedisUrl = resolveBullMqRedisUrl();
  const parsed = parseRedisUrl(bullMqRedisUrl);
  return omitUndefined({
    host: parsed.host,
    port: parsed.port,
    password: parsed.password,
    db: parsed.databaseIndex,
    maxRetriesPerRequest: null,
    prefix: resolveRedisKeyPrefix(),
    tls: isRedisTlsUrl(bullMqRedisUrl) ? {} : undefined,
  });
}
