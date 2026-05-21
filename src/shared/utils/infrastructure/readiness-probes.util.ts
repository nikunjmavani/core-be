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

export const HEALTH_READINESS_PROBE_TIMEOUT_MILLISECONDS = HEALTH_READINESS_PROBE_TIMEOUT_MS;

export type ReadinessComponentName = 'database' | 'redis' | 'bullmq';

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
