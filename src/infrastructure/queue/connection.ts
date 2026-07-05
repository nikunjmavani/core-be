import { resolveRedisKeyPrefix } from '@/infrastructure/cache/redis-prefix.util.js';
import { parseRedisUrl, resolveBullMqRedisUrl } from '@/infrastructure/cache/redis-url.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { TEN_SECONDS_MS } from '@/shared/constants/ttl.constants.js';

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
  enableReadyCheck: boolean;
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
    // #786: BullMQ Queue/Worker connections (same `core:<env>:` prefix as the cache client) default
    // to ioredis `enableReadyCheck: true`. The test harness churns the producer-queue connections
    // across createTestApp instances; a reconnect's INFO ready-check then rejects against a closing
    // stream at Vitest worker teardown — a flaky unhandled rejection on an otherwise-green run.
    // The harness sets REDIS_READY_CHECK_ENABLED=false to disable it under test (local/CI Redis is
    // ready immediately); unset elsewhere keeps it on and the schema refine keeps it on in production.
    // Reads raw `process.env` (always current; the `env` const is frozen pre-flags) so no env-config
    // mock is required, matching the existing `process.env.RUN_REDIS_TESTS` test gate.
    enableReadyCheck: process.env.REDIS_READY_CHECK_ENABLED !== 'false',
    prefix: resolveRedisKeyPrefix(),
  });
}

/**
 * Command timeout (ms) for BullMQ **producer** connections (audit-#5).
 *
 * @remarks
 * `maxRetriesPerRequest: null` (required by BullMQ) means an in-flight command to a
 * connected-but-unresponsive Redis (failover mid-command, swap storm, paused
 * cluster) never rejects on its own. Producers only issue non-blocking commands
 * (`add()`), so a bounded `commandTimeout` makes an enqueue fail fast instead of
 * hanging for the whole incident. It is intentionally NOT applied to the worker /
 * scheduler connection ({@link getBullMQConnectionOptions}), whose blocking
 * `BRPOPLPUSH` long-poll legitimately outlives any command timeout.
 */
const BULLMQ_PRODUCER_COMMAND_TIMEOUT_MS = TEN_SECONDS_MS;

/**
 * BullMQ connection options for **queue producers** (the `*.queue.ts` enqueue helpers).
 *
 * @remarks
 * Identical to {@link getBullMQConnectionOptions} but pins `enableOfflineQueue: false` so a
 * producer fails fast during a Redis partition instead of buffering the `add()` in memory,
 * and adds a bounded `commandTimeout` (audit-#5) so a command to a connected-but-unresponsive
 * Redis rejects instead of hanging. Because `maxRetriesPerRequest` is `null`, a buffered or
 * in-flight command would otherwise never reject — an enqueue issued from an HTTP request or
 * post-commit event handler would hang for the whole outage rather than surfacing an error the
 * caller can log or convert to a 5xx. Every domain producer queue uses this so the fail-fast
 * behavior is uniform (previously only the mail queue set it inline). Workers and the boot-time
 * scheduler intentionally keep {@link getBullMQConnectionOptions} (blocking consumers /
 * created-and-used-at-boot) with no command timeout.
 */
export function getBullMQProducerConnectionOptions(): ReturnType<
  typeof getBullMQConnectionOptions
> & { enableOfflineQueue: false; commandTimeout: number } {
  return {
    ...getBullMQConnectionOptions(),
    enableOfflineQueue: false,
    commandTimeout: BULLMQ_PRODUCER_COMMAND_TIMEOUT_MS,
  };
}
