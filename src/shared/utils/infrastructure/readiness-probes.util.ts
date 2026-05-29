import { bullmqRedisConnection } from '@/infrastructure/cache/bullmq-redis.client.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { usesSeparateBullMqRedisEndpoint } from '@/infrastructure/cache/redis-url.parse.util.js';
import { env } from '@/shared/config/env.config.js';
import { resolveBullMqRedisUrl } from '@/infrastructure/cache/redis-url.util.js';
import { sql } from '@/infrastructure/database/connection.js';
import { pingBullMQ } from '@/infrastructure/queue/health.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { HEALTH_READINESS_PROBE_TIMEOUT_MS } from '@/shared/constants/ttl.constants.js';
import { readinessProbeTimeout } from '@/shared/utils/infrastructure/readiness-probe-timeout.util.js';

/** Re-export of {@link HEALTH_READINESS_PROBE_TIMEOUT_MS} kept for legacy import paths. */
export const HEALTH_READINESS_PROBE_TIMEOUT_MILLISECONDS = HEALTH_READINESS_PROBE_TIMEOUT_MS;

/** Components a readiness probe checks: Postgres, primary Redis, BullMQ Redis. */
export type ReadinessComponentName = 'database' | 'redis' | 'bullmq';

/** Aggregated readiness result returned by {@link runDependencyReadinessProbes}. */
export type ReadinessProbeSummary = {
  readonly status: 'ok' | 'error' | 'draining';
  readonly database: 'connected' | 'unavailable';
  readonly redis: 'connected' | 'unavailable';
  readonly bullmq: 'connected' | 'unavailable';
  readonly latencyMs: Record<ReadinessComponentName, number | null>;
};

type SuccessfulProbeOutcome = {
  readonly readinessComponentName: ReadinessComponentName;
  readonly latencyMilliseconds: number;
};

type FailedProbeOutcome = {
  readonly readinessComponentName: ReadinessComponentName;
  readonly error: unknown;
};

function isSuccessfulProbeOutcome(
  outcome: SuccessfulProbeOutcome | FailedProbeOutcome,
): outcome is SuccessfulProbeOutcome {
  return 'latencyMilliseconds' in outcome;
}

async function runReadinessProbe(
  readinessComponentName: ReadinessComponentName,
  probe: () => Promise<void>,
): Promise<SuccessfulProbeOutcome | FailedProbeOutcome> {
  const startedAtMilliseconds = performance.now();
  try {
    await readinessProbeTimeout(
      probe(),
      HEALTH_READINESS_PROBE_TIMEOUT_MILLISECONDS,
      readinessComponentName,
    );
    return {
      readinessComponentName,
      latencyMilliseconds: Math.round(performance.now() - startedAtMilliseconds),
    };
  } catch (error) {
    logger.warn({ check: readinessComponentName, error }, 'health.ready.check.failed');
    return {
      readinessComponentName,
      error,
    };
  }
}

function summarizeReadinessProbeOutcome(outcome: SuccessfulProbeOutcome | FailedProbeOutcome): {
  readonly connectivitySucceeded: boolean;
  readonly latencyMilliseconds: number | null;
} {
  if (isSuccessfulProbeOutcome(outcome)) {
    return {
      connectivitySucceeded: true,
      latencyMilliseconds: outcome.latencyMilliseconds,
    };
  }
  return { connectivitySucceeded: false, latencyMilliseconds: null };
}

function buildReadinessConnectivityLabel(
  connectivitySucceeded: boolean,
): 'connected' | 'unavailable' {
  return connectivitySucceeded ? 'connected' : 'unavailable';
}

/**
 * Short window during which a {@link runDependencyReadinessProbes} result is
 * reused by {@link getCachedDependencyReadinessProbes}. Keeps Docker/Railway
 * deploy gating and external readiness pollers from issuing unthrottled
 * Postgres/Redis/BullMQ probes; intentionally small so a genuine dependency
 * outage is reflected within a couple of seconds.
 */
const READINESS_PROBE_CACHE_TTL_MILLISECONDS = 2_000;

type CachedReadinessProbeSummary = {
  readonly summary: ReadinessProbeSummary;
  readonly cachedAtMilliseconds: number;
};

let cachedReadinessProbeSummary: CachedReadinessProbeSummary | null = null;
let inFlightReadinessProbe: Promise<ReadinessProbeSummary> | null = null;

/**
 * Runs Postgres, Redis, and BullMQ readiness probes in parallel under a shared
 * {@link HEALTH_READINESS_PROBE_TIMEOUT_MILLISECONDS} budget and returns
 * `status: 'ok'` only when every probe succeeded. Used by the worker process
 * readiness signal and as the uncached source for
 * {@link getCachedDependencyReadinessProbes}.
 */
export async function runDependencyReadinessProbes(): Promise<ReadinessProbeSummary> {
  const [databaseOutcome, redisOutcome, bullMqOutcome] = await Promise.all([
    runReadinessProbe('database', async () => {
      await sql`select 1`;
    }),
    runReadinessProbe('redis', async () => {
      const pongMessage = await redisConnection.ping();
      if (pongMessage !== 'PONG') {
        throw new Error('redis_ping_unexpected_response');
      }
      if (usesSeparateBullMqRedisEndpoint(env.REDIS_URL, resolveBullMqRedisUrl())) {
        const bullMqPongMessage = await bullmqRedisConnection.ping();
        if (bullMqPongMessage !== 'PONG') {
          throw new Error('redis_bullmq_ping_unexpected_response');
        }
      }
    }),
    runReadinessProbe('bullmq', pingBullMQ),
  ]);

  const databaseProbeSummary = summarizeReadinessProbeOutcome(databaseOutcome);
  const redisProbeSummary = summarizeReadinessProbeOutcome(redisOutcome);
  const bullMqProbeSummary = summarizeReadinessProbeOutcome(bullMqOutcome);

  const allDependenciesReady =
    databaseProbeSummary.connectivitySucceeded &&
    redisProbeSummary.connectivitySucceeded &&
    bullMqProbeSummary.connectivitySucceeded;

  return {
    status: allDependenciesReady ? 'ok' : 'error',
    database: buildReadinessConnectivityLabel(databaseProbeSummary.connectivitySucceeded),
    redis: buildReadinessConnectivityLabel(redisProbeSummary.connectivitySucceeded),
    bullmq: buildReadinessConnectivityLabel(bullMqProbeSummary.connectivitySucceeded),
    latencyMs: {
      database: databaseProbeSummary.latencyMilliseconds,
      redis: redisProbeSummary.latencyMilliseconds,
      bullmq: bullMqProbeSummary.latencyMilliseconds,
    },
  };
}

/**
 * Returns dependency readiness, reusing a result computed within the last
 * {@link READINESS_PROBE_CACHE_TTL_MILLISECONDS}. Concurrent callers during a
 * cache miss share a single in-flight probe so a burst of `/readyz` (or the
 * `/health` alias) requests collapses to one round of Postgres/Redis/BullMQ
 * checks. Used by the HTTP readiness endpoints.
 *
 * @remarks
 * - **Algorithm:** serve fresh cache → otherwise await the shared in-flight
 *   probe → otherwise start one and memoise its result.
 * - **Failure modes:** a rejected probe round propagates to the awaiting
 *   callers and is not cached; the next call re-probes.
 * - **Side effects:** mutates module-level cache state; no I/O beyond the
 *   delegated {@link runDependencyReadinessProbes} call.
 */
export async function getCachedDependencyReadinessProbes(): Promise<ReadinessProbeSummary> {
  const nowMilliseconds = performance.now();
  if (
    cachedReadinessProbeSummary &&
    nowMilliseconds - cachedReadinessProbeSummary.cachedAtMilliseconds <
      READINESS_PROBE_CACHE_TTL_MILLISECONDS
  ) {
    return cachedReadinessProbeSummary.summary;
  }

  if (inFlightReadinessProbe) {
    return inFlightReadinessProbe;
  }

  inFlightReadinessProbe = (async () => {
    try {
      const summary = await runDependencyReadinessProbes();
      cachedReadinessProbeSummary = {
        summary,
        cachedAtMilliseconds: performance.now(),
      };
      return summary;
    } finally {
      inFlightReadinessProbe = null;
    }
  })();

  return inFlightReadinessProbe;
}

/** Test-only reset of the readiness probe cache — avoids bleed between Vitest cases. */
export function resetReadinessProbeCacheForTests(): void {
  cachedReadinessProbeSummary = null;
  inFlightReadinessProbe = null;
}
