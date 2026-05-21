import { sql } from '@/infrastructure/database/connection.js';
import { resolvePostgresAllowedApplicationConnections } from '@/infrastructure/database/assert-connection-budget.js';
import { getEnv } from '@/shared/config/env.config.js';
import { isMetricsEnabled } from '@/infrastructure/observability/metrics/metrics-registry.js';
import {
  evaluatePoolExhaustionAndAlert,
  resetPoolExhaustionAlertStateForTests,
} from '@/infrastructure/observability/dlq-depth/db-pool-alert.service.js';
import {
  setPostgresPoolConfigMetrics,
  setPostgresPoolConnectionCounts,
} from '@/infrastructure/observability/metrics/prometheus-metrics.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

type PoolState = 'active' | 'idle' | 'waiting';

type PoolCountRow = {
  state: PoolState;
  count: number;
};

/**
 * Samples connection counts from pg_stat_activity for the current database user.
 * Approximates pool utilization when postgres.js does not expose live pool stats.
 */
async function samplePostgresPoolConnectionCounts(): Promise<PoolCountRow[]> {
  const rows = await sql`
    SELECT
      CASE
        WHEN state = 'active' THEN 'active'
        WHEN state = 'idle' THEN 'idle'
        ELSE 'waiting'
      END AS state,
      COUNT(*)::text AS count
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = current_user
      AND pid <> pg_backend_pid()
    GROUP BY 1
  `;

  const counts: Record<PoolState, number> = { active: 0, idle: 0, waiting: 0 };
  for (const row of rows) {
    const state = row.state as PoolState;
    if (state in counts) {
      // eslint-disable-next-line security/detect-object-injection -- state checked via `state in counts` (typed PoolState).
      counts[state] = Number.parseInt(row.count, 10) || 0;
    }
  }

  return (['active', 'idle', 'waiting'] as const).map((state) => ({
    state,
    // eslint-disable-next-line security/detect-object-injection -- state is a typed PoolState constant.
    count: counts[state],
  }));
}

function sumClusterActiveConnections(samples: ReadonlyArray<PoolCountRow>): number {
  const active = samples.find((sample) => sample.state === 'active')?.count ?? 0;
  const waiting = samples.find((sample) => sample.state === 'waiting')?.count ?? 0;
  return active + waiting;
}

let cachedAllowedApplicationConnections: number | null = null;

async function resolveAllowedApplicationConnectionsCached(): Promise<number> {
  if (cachedAllowedApplicationConnections !== null) {
    return cachedAllowedApplicationConnections;
  }
  try {
    cachedAllowedApplicationConnections = await resolvePostgresAllowedApplicationConnections();
    return cachedAllowedApplicationConnections;
  } catch (error) {
    logger.warn({ error }, 'database.pool.allowed_connections.resolve_failed');
    return 0;
  }
}

/** Pool gauge refresh and exhaustion alert interval (default from env). */
export function resolvePostgresPoolPollIntervalMs(): number {
  return getEnv().DB_POOL_ALERT_POLL_INTERVAL_MS;
}

let poolMonitoringInterval: ReturnType<typeof setInterval> | null = null;

export async function refreshPostgresPoolMetrics(): Promise<void> {
  const maxConnections = getEnv().DB_MAX ?? 10;
  let samples: PoolCountRow[] = [];
  let liveMetricsAvailable = false;

  try {
    samples = await samplePostgresPoolConnectionCounts();
    liveMetricsAvailable = true;
  } catch (error) {
    logger.warn({ error }, 'metrics.postgres_pool.sample_failed');
    samples = (['active', 'idle', 'waiting'] as const).map((state) => ({ state, count: 0 }));
  }

  if (isMetricsEnabled()) {
    setPostgresPoolConnectionCounts(samples);
    setPostgresPoolConfigMetrics({
      maxConnections,
      liveMetricsAvailable,
    });
  }

  const allowedApplicationConnections = await resolveAllowedApplicationConnectionsCached();
  const clusterActiveConnections = sumClusterActiveConnections(samples);
  evaluatePoolExhaustionAndAlert({
    clusterActiveConnections,
    allowedApplicationConnections,
  });
}

export function registerPostgresPoolMetrics(): void {
  if (poolMonitoringInterval) {
    return;
  }

  void refreshPostgresPoolMetrics();
  poolMonitoringInterval = setInterval(() => {
    void refreshPostgresPoolMetrics();
  }, resolvePostgresPoolPollIntervalMs());
}

export function stopPostgresPoolMetricsPolling(): void {
  if (poolMonitoringInterval) {
    clearInterval(poolMonitoringInterval);
    poolMonitoringInterval = null;
  }
}

/** Test-only: stop polling and reset alert consecutive counters. */
export function resetPostgresPoolMonitoringForTests(): void {
  stopPostgresPoolMetricsPolling();
  resetPoolExhaustionAlertStateForTests();
  cachedAllowedApplicationConnections = null;
}
