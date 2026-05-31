import type { Redis } from 'ioredis';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Result shape `@fastify/rate-limit` expects from a store's `incr`. */
interface RateLimitIncrResult {
  current: number;
  ttl: number;
}

type RateLimitIncrCallback = (error: Error | null, result: RateLimitIncrResult | null) => void;

/** Subset of `@fastify/rate-limit`'s route options passed to `store.child`. */
interface RateLimitChildOptions {
  routeInfo?: { method?: string; url?: string };
}

const DEFAULT_KEY_PREFIX = 'fastify-rate-limit-';
const LOCAL_COUNTER_PRUNE_THRESHOLD = 10_000;
const FAILOVER_LOG_INTERVAL_MS = 5_000;

let lastFailoverLogAtMs = 0;

function logRedisFailover(error: unknown): void {
  const now = Date.now();
  if (now - lastFailoverLogAtMs < FAILOVER_LOG_INTERVAL_MS) {
    return;
  }
  lastFailoverLogAtMs = now;
  logger.warn({ error }, 'rate_limit.redis_failover.local');
}

/**
 * `@fastify/rate-limit` store that counts in Redis but transparently falls over to a
 * per-process in-memory fixed-window counter when Redis is unavailable.
 *
 * @remarks
 * - **Algorithm:** `incr` runs `INCR` + `PEXPIRE`/`PTTL` against Redis (cluster-wide count);
 *   on any Redis rejection it counts in a local `Map` keyed by the same bucket and returns
 *   that count instead. `child` returns a new store with a route-scoped key prefix so per-route
 *   presets keep isolated buckets.
 * - **Failure modes:** none surfaced to the caller — Redis errors are caught and converted into
 *   local enforcement, so the limiter never throws (and never has to fail fully open).
 * - **Side effects:** writes Redis keys; maintains a bounded in-memory counter map (pruned past
 *   {@link LOCAL_COUNTER_PRUNE_THRESHOLD}); emits a rate-limited `rate_limit.redis_failover.local`
 *   warning while degraded.
 * - **Notes:** the local fallback caps throughput per process (not cluster-wide), so a Redis
 *   outage degrades precision but — unlike `skipOnError` alone — does not leave the API unmetered.
 */
class RedisFallbackRateLimitStore {
  private readonly localCounters = new Map<string, { count: number; expiresAtMs: number }>();

  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string,
  ) {}

  incr(key: string, callback: RateLimitIncrCallback, timeWindow: number, _max: number): void {
    const fullKey = `${this.keyPrefix}${key}`;
    this.incrInRedis(fullKey, timeWindow)
      .then((result) => callback(null, result))
      .catch((error) => {
        logRedisFailover(error);
        callback(null, this.incrInMemory(fullKey, timeWindow));
      });
  }

  private async incrInRedis(fullKey: string, timeWindow: number): Promise<RateLimitIncrResult> {
    const current = await this.redis.incr(fullKey);
    if (current === 1) {
      await this.redis.pexpire(fullKey, timeWindow);
      return { current, ttl: timeWindow };
    }
    const ttl = await this.redis.pttl(fullKey);
    return { current, ttl: ttl >= 0 ? ttl : timeWindow };
  }

  private incrInMemory(fullKey: string, timeWindow: number): RateLimitIncrResult {
    const now = Date.now();
    const existing = this.localCounters.get(fullKey);
    if (!existing || existing.expiresAtMs <= now) {
      if (this.localCounters.size >= LOCAL_COUNTER_PRUNE_THRESHOLD) {
        this.pruneExpiredLocalCounters(now);
      }
      this.localCounters.set(fullKey, { count: 1, expiresAtMs: now + timeWindow });
      return { current: 1, ttl: timeWindow };
    }
    existing.count += 1;
    return { current: existing.count, ttl: existing.expiresAtMs - now };
  }

  private pruneExpiredLocalCounters(now: number): void {
    for (const [key, value] of this.localCounters) {
      if (value.expiresAtMs <= now) {
        this.localCounters.delete(key);
      }
    }
  }

  child(routeOptions: RateLimitChildOptions): RedisFallbackRateLimitStore {
    const routeInfo = routeOptions.routeInfo ?? {};
    const childPrefix = `${this.keyPrefix}${routeInfo.method ?? ''}${routeInfo.url ?? ''}-`;
    return new RedisFallbackRateLimitStore(this.redis, childPrefix);
  }
}

/**
 * Builds the `store` constructor `@fastify/rate-limit` instantiates (`new Store(params)`),
 * bound to `redis`. Returns a {@link RedisFallbackRateLimitStore} so Redis blips degrade to
 * per-process limiting instead of skipping enforcement entirely.
 *
 * @remarks
 * - **Algorithm:** returns a class whose constructor ignores the plugin params and closes over
 *   `redis`, delegating all counting to {@link RedisFallbackRateLimitStore}.
 * - **Failure modes:** none.
 * - **Side effects:** none at build time; the returned store performs Redis/in-memory writes.
 * - **Notes:** pass as `options.store`; do not also pass `options.redis`.
 */
export function createRedisFallbackRateLimitStore(redis: Redis): new (params: unknown) => unknown {
  return class BoundRedisFallbackRateLimitStore extends RedisFallbackRateLimitStore {
    constructor(_params: unknown) {
      super(redis, DEFAULT_KEY_PREFIX);
    }
  };
}
