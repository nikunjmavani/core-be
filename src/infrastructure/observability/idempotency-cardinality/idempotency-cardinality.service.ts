import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  IDEMPOTENCY_CACHE_KEY_MATCH_PATTERN,
  IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY,
} from '@/shared/utils/idempotency/idempotency-key.util.js';

export interface IdempotencyCardinalitySampleResult {
  observedCount: number;
  scanTruncated: boolean;
}

/**
 * Samples the approximate cardinality of idempotency cache keys in Redis (SCAN),
 * optionally alerts when crossing configured thresholds, and resets the
 * Approximate-claim counter so it tracks the last observed SCAN count.
 */
export async function sampleIdempotencyCardinality(): Promise<IdempotencyCardinalitySampleResult> {
  const maxKeys = env.IDEMPOTENCY_CARDINALITY_SCAN_MAX;
  let cursor = '0';
  let observedCount = 0;
  let scanTruncated = false;

  try {
    while (true) {
      const [nextCursor, keys] = await redisConnection.scan(
        cursor,
        'MATCH',
        IDEMPOTENCY_CACHE_KEY_MATCH_PATTERN,
        'COUNT',
        1000,
      );
      cursor = nextCursor;
      observedCount += keys.length;

      if (observedCount >= maxKeys) {
        scanTruncated = cursor !== '0';
        break;
      }
      if (cursor === '0') break;
    }
  } catch (error) {
    logger.error({ error }, 'idempotency.cardinality.scan.failed');
    throw error;
  }

  try {
    await redisConnection.set(IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY, String(observedCount));
  } catch (error) {
    logger.warn({ error, observedCount }, 'idempotency.cardinality.counter.sync.failed');
  }

  const warnThreshold = env.IDEMPOTENCY_CARDINALITY_WARN_THRESHOLD;
  const criticalThreshold = env.IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD;

  if (observedCount >= criticalThreshold) {
    logger.error(
      {
        observedCount,
        warnThreshold,
        criticalThreshold,
        scanTruncated,
      },
      'idempotency.cache.cardinality.critical',
    );
    captureMessage('idempotency.cache.cardinality.critical', {
      level: 'error',
      extra: { observedCount, warnThreshold, criticalThreshold, scanTruncated },
    });
  } else if (observedCount >= warnThreshold) {
    logger.warn(
      {
        observedCount,
        warnThreshold,
        criticalThreshold,
        scanTruncated,
      },
      'idempotency.cache.cardinality.high',
    );
    captureMessage('idempotency.cache.cardinality.high', {
      level: 'warning',
      extra: { observedCount, warnThreshold, criticalThreshold, scanTruncated },
    });
  }

  return { observedCount, scanTruncated };
}
