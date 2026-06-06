import { usesSeparateBullMqRedisEndpoint } from '@/infrastructure/cache/redis-url.parse.util.js';
import { resolveBullMqRedisUrl } from '@/infrastructure/cache/redis-url.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Fixed mask written over a URL password before logging — a redaction marker, never a credential. */
const URL_REDACTION_MARK = '*'.repeat(3);

/** Redacts the password in a connection URL for safe logging (URL parse — no regex backtracking). */
function redactUrlPassword(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = URL_REDACTION_MARK;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Logs the resolved Redis topology at boot.
 *
 * @remarks
 * sec-Q2: the previous function name implied "warn when sharing" but the
 * conditional did the OPPOSITE — it short-circuited silently in the
 * dangerous case (shared host) and only emitted a positive INFO when the
 * isolation was already correct. Operators who accidentally pointed
 * BullMQ at the cache Redis got no signal — risking a BullMQ-backlog
 * driven OOM of the rate-limit / idempotency store.
 *
 * Renamed conceptually to `logRedisTopology`: WARN in the shared case
 * (the only event worth flagging), INFO in the isolated case.
 */
export function warnWhenBullMqSharesCacheRedisHost(): void {
  const bullMqRedisUrl = resolveBullMqRedisUrl();
  const isolated = usesSeparateBullMqRedisEndpoint(env.REDIS_URL, bullMqRedisUrl);
  const payload = {
    cacheRedisUrl: redactUrlPassword(env.REDIS_URL),
    bullMqRedisUrl: redactUrlPassword(bullMqRedisUrl),
  };

  if (isolated) {
    logger.info(
      payload,
      'redis.topology.dedicated_bullmq_endpoint — BullMQ uses a dedicated Redis endpoint; queue/cache isolation is active (see docs/deployment/runbooks/redis-topology.md)',
    );
    return;
  }

  logger.warn(
    payload,
    'redis.topology.shared_bullmq_endpoint — BullMQ shares the cache Redis endpoint; a BullMQ backlog can starve rate-limit / idempotency / session-cache keys (set REDIS_BULLMQ_URL to a dedicated endpoint for production).',
  );
}
