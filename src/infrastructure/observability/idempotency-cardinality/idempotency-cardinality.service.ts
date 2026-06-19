import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  IDEMPOTENCY_CACHE_KEY_MATCH_PATTERN,
  IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY,
} from '@/shared/utils/idempotency/idempotency-key.util.js';

/** Per-iteration `SCAN ... COUNT` hint — pages the keyspace in ~1000-key batches. */
const IDEMPOTENCY_SCAN_COUNT = 1000;

/** Extra SCAN round-trips allowed over the minimum `maxKeys / COUNT` before the iteration guard trips. */
const IDEMPOTENCY_SCAN_ITERATION_SLACK = 100;

/**
 * Result of {@link sampleIdempotencyCardinality} — approximate Redis SCAN count
 * for idempotency keys plus a `scanTruncated` flag set when the bounded scan
 * gave up before exhausting the keyspace.
 *
 * @remarks
 * - **Algorithm:** `observedCount` is summed across SCAN pages with COUNT=1000;
 *   `scanTruncated = true` indicates the count is a lower bound capped at
 *   `IDEMPOTENCY_CARDINALITY_SCAN_MAX`.
 * - **Failure modes:** never returned on scan failure (the sampler throws);
 *   counter-sync failures still allow the result to be returned.
 * - **Side effects:** none from the type itself.
 * - **Notes:** consumed by the worker for structured logging.
 */
export interface IdempotencyCardinalitySampleResult {
  observedCount: number;
  scanTruncated: boolean;
}

/**
 * Bounded Redis SCAN over idempotency cache keys that resets the claim counter
 * and raises Sentry alerts when growth crosses warn/critical thresholds.
 *
 * @remarks
 * - **Algorithm:** iterates `SCAN MATCH IDEMPOTENCY_CACHE_KEY_MATCH_PATTERN COUNT 1000`
 *   until cursor returns to `'0'` or `observedCount >= IDEMPOTENCY_CARDINALITY_SCAN_MAX`,
 *   then writes the observed total to `IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY`.
 * - **Failure modes:** scan errors are logged and rethrown (so BullMQ retries);
 *   counter-sync failures are logged at warn but do NOT abort the sample.
 * - **Side effects:** Redis `SCAN` pages; `SET` on the claim counter key;
 *   Sentry `captureMessage` with `level: 'error'` or `'warning'` when over
 *   `IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD` / `_WARN_THRESHOLD`.
 * - **Notes:** the scan is bounded to keep Redis CPU predictable; treat
 *   `scanTruncated === true` as "alert may underestimate".
 */
export async function sampleIdempotencyCardinality(): Promise<IdempotencyCardinalitySampleResult> {
  const maxKeys = env.IDEMPOTENCY_CARDINALITY_SCAN_MAX;
  // Bound the number of SCAN round-trips so a pathological cursor (or a keyspace far
  // larger than maxKeys that yields small/empty pages) can never spin this sampler
  // indefinitely and pin Redis CPU. Generous headroom over the minimum maxKeys/COUNT
  // pages, so normal truncation still trips on the observedCount cap first.
  const maxIterations =
    Math.ceil(maxKeys / IDEMPOTENCY_SCAN_COUNT) + IDEMPOTENCY_SCAN_ITERATION_SLACK;
  let cursor = '0';
  let observedCount = 0;
  let scanTruncated = false;
  let iterations = 0;

  try {
    while (true) {
      iterations += 1;
      const [nextCursor, keys] = await redisConnection.scan(
        cursor,
        'MATCH',
        IDEMPOTENCY_CACHE_KEY_MATCH_PATTERN,
        'COUNT',
        IDEMPOTENCY_SCAN_COUNT,
      );
      cursor = nextCursor;
      observedCount += keys.length;

      if (observedCount >= maxKeys) {
        scanTruncated = cursor !== '0';
        break;
      }
      if (cursor === '0') break;
      if (iterations >= maxIterations) {
        // Hit the round-trip guard before exhausting the keyspace — treat as truncated.
        scanTruncated = true;
        logger.warn(
          { observedCount, iterations, maxIterations },
          'idempotency.cardinality.scan.iteration_cap_reached',
        );
        break;
      }
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
