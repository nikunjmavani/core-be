import { sql } from '@/infrastructure/database/connection.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  getWorkerConcurrencyMail,
  getWorkerConcurrencyNotify,
  getWorkerConcurrencyStripe,
  getWorkerConcurrencyWebhook,
} from '@/shared/config/worker-concurrency.util.js';

const DEFAULT_POOL_MAX_CONNECTIONS = 10;
/** Local docker-compose default: one API + one worker process. */
const LOCAL_DEFAULT_API_PROCESS_COUNT = 1;
const LOCAL_DEFAULT_WORKER_PROCESS_COUNT = 1;

export type AssertConnectionBudgetOptions = {
  /** When true, validates WORKER_CONCURRENCY against DATABASE_POOL_MAX minus retention worker slots. */
  readonly assertWorkerConcurrency?: boolean;
};

type ResolvedDeploymentCounts =
  | {
      readonly kind: 'split';
      readonly apiProcessCount: number;
      readonly workerProcessCount: number;
      readonly usedInferredLocalDefaults: boolean;
    }
  | {
      readonly kind: 'total';
      readonly totalProcessCount: number;
    };

function resolvePoolMaxConnections(): number {
  return env.DATABASE_POOL_MAX ?? DEFAULT_POOL_MAX_CONNECTIONS;
}

export async function resolvePostgresMaxConnections(): Promise<number> {
  if (env.POSTGRES_MAX_CONNECTIONS !== undefined) {
    return env.POSTGRES_MAX_CONNECTIONS;
  }

  const rows = await sql<{ setting: string }[]>`
    SELECT setting
    FROM pg_settings
    WHERE name = 'max_connections'
  `;
  const setting = rows[0]?.setting;
  if (!setting) {
    throw new Error('database.connection_budget.max_connections_query_empty');
  }

  const parsed = Number.parseInt(setting, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`database.connection_budget.invalid_max_connections:${setting}`);
  }
  return parsed;
}

/**
 * Detect hosted deployments where the connection budget must always be validated
 * against explicit replica counts. Local development and CI runners do not set
 * these markers, so they retain the 1-API + 1-worker docker-compose fallback.
 */
function isHostedDeployment(): boolean {
  if (env.NODE_ENV === 'production') {
    return true;
  }
  if (env.RAILWAY_GIT_COMMIT_SHA !== undefined) {
    return true;
  }
  if (
    typeof process.env.KUBERNETES_SERVICE_HOST === 'string' &&
    process.env.KUBERNETES_SERVICE_HOST.length > 0
  ) {
    return true;
  }
  return false;
}

function resolveDeploymentCounts(): ResolvedDeploymentCounts | undefined {
  const apiExplicit = env.DEPLOYMENT_API_REPLICA_COUNT;
  const workerExplicit = env.DEPLOYMENT_WORKER_REPLICA_COUNT;
  const hasPartialSplit =
    (apiExplicit !== undefined && workerExplicit === undefined) ||
    (apiExplicit === undefined && workerExplicit !== undefined);

  if (hasPartialSplit) {
    throw new Error(
      'DEPLOYMENT_API_REPLICA_COUNT and DEPLOYMENT_WORKER_REPLICA_COUNT must both be set when using either',
    );
  }

  if (apiExplicit !== undefined && workerExplicit !== undefined) {
    return {
      kind: 'split',
      apiProcessCount: apiExplicit,
      workerProcessCount: workerExplicit,
      usedInferredLocalDefaults: false,
    };
  }

  const total = env.DEPLOYMENT_TOTAL_REPLICA_COUNT;
  if (total !== undefined) {
    return { kind: 'total', totalProcessCount: total };
  }

  if (isHostedDeployment()) {
    return undefined;
  }

  return {
    kind: 'split',
    apiProcessCount: LOCAL_DEFAULT_API_PROCESS_COUNT,
    workerProcessCount: LOCAL_DEFAULT_WORKER_PROCESS_COUNT,
    usedInferredLocalDefaults: true,
  };
}

function computeRequiredPoolConnections(
  counts: ResolvedDeploymentCounts,
  poolMaxConnections: number,
): number {
  if (counts.kind === 'total') {
    return counts.totalProcessCount * poolMaxConnections;
  }

  return (counts.apiProcessCount + counts.workerProcessCount) * poolMaxConnections;
}

function buildDeploymentBudgetErrorMessage(parameters: {
  poolMaxConnections: number;
  postgresMaxConnections: number;
  reservedConnections: number;
  allowedApplicationConnections: number;
  requiredConnections: number;
  deploymentSummary: string;
}): string {
  return (
    `Postgres connection budget exceeded: ${parameters.deploymentSummary} requires ` +
    `${parameters.requiredConnections} pool connections at DATABASE_POOL_MAX ${parameters.poolMaxConnections}, ` +
    `but only ${parameters.allowedApplicationConnections} are available ` +
    `(max_connections ${parameters.postgresMaxConnections} − reserved ${parameters.reservedConnections}). ` +
    'Set DEPLOYMENT_TOTAL_REPLICA_COUNT or DEPLOYMENT_API_REPLICA_COUNT / DEPLOYMENT_WORKER_REPLICA_COUNT, DATABASE_POOL_MAX, ' +
    'POSTGRES_MAX_CONNECTIONS, or POSTGRES_RESERVED_CONNECTIONS. ' +
    'See docs/deployment/runbooks/resource-limits.md'
  );
}

function formatDeploymentSummary(
  counts: ResolvedDeploymentCounts,
  poolMaxConnections: number,
): string {
  if (counts.kind === 'total') {
    return `${counts.totalProcessCount} processes × DATABASE_POOL_MAX ${poolMaxConnections}`;
  }

  return `${counts.apiProcessCount} API + ${counts.workerProcessCount} worker processes × DATABASE_POOL_MAX ${poolMaxConnections}`;
}

/** Application connection headroom: max_connections minus reserved admin/migration slots. */
export async function resolvePostgresAllowedApplicationConnections(): Promise<number> {
  const postgresMaxConnections = await resolvePostgresMaxConnections();
  return postgresMaxConnections - env.POSTGRES_RESERVED_CONNECTIONS;
}

/**
 * Validates postgres.js pool sizing against Postgres max_connections and deployment process count.
 * Call once at API and worker process startup.
 */
export async function assertPostgresConnectionBudget(
  options: AssertConnectionBudgetOptions = {},
): Promise<void> {
  const poolMaxConnections = resolvePoolMaxConnections();
  const reservedConnections = env.POSTGRES_RESERVED_CONNECTIONS;
  const postgresMaxConnections = await resolvePostgresMaxConnections();
  const allowedApplicationConnections = postgresMaxConnections - reservedConnections;

  if (allowedApplicationConnections < 1) {
    throw new Error(
      `Postgres reserved connection headroom (${reservedConnections}) exceeds or equals max_connections (${postgresMaxConnections})`,
    );
  }

  const deploymentCounts = resolveDeploymentCounts();

  if (deploymentCounts !== undefined) {
    const requiredConnections = computeRequiredPoolConnections(
      deploymentCounts,
      poolMaxConnections,
    );
    if (requiredConnections > allowedApplicationConnections) {
      throw new Error(
        buildDeploymentBudgetErrorMessage({
          poolMaxConnections,
          postgresMaxConnections,
          reservedConnections,
          allowedApplicationConnections,
          requiredConnections,
          deploymentSummary: formatDeploymentSummary(deploymentCounts, poolMaxConnections),
        }),
      );
    }

    const logPayload =
      deploymentCounts.kind === 'split'
        ? {
            apiProcessCount: deploymentCounts.apiProcessCount,
            workerProcessCount: deploymentCounts.workerProcessCount,
            usedInferredLocalDefaults: deploymentCounts.usedInferredLocalDefaults,
          }
        : { deploymentProcessCount: deploymentCounts.totalProcessCount };

    logger.info(
      {
        ...logPayload,
        poolMaxConnections,
        postgresMaxConnections,
        reservedConnections,
        requiredConnections,
        allowedApplicationConnections,
      },
      'database.connection_budget.ok',
    );
  } else if (isHostedDeployment()) {
    throw new Error(
      'DEPLOYMENT_TOTAL_REPLICA_COUNT (or DEPLOYMENT_API_REPLICA_COUNT + DEPLOYMENT_WORKER_REPLICA_COUNT) ' +
        'is required for hosted deployments (production, or any environment with RAILWAY_GIT_COMMIT_SHA / ' +
        'KUBERNETES_SERVICE_HOST set) to validate Postgres connection budget. ' +
        'Set the secret in the GitHub Environment so deploy-railway.yml forwards it to the service. ' +
        'See docs/deployment/runbooks/resource-limits.md',
    );
  }

  if (options.assertWorkerConcurrency) {
    const backgroundReserve = env.WORKER_BACKGROUND_POOL_SLOT_RESERVE;
    const workerConcurrency = env.WORKER_CONCURRENCY;
    const maxWorkerConcurrency = poolMaxConnections - backgroundReserve;
    if (workerConcurrency > maxWorkerConcurrency) {
      throw new Error(
        `WORKER_CONCURRENCY (${workerConcurrency}) exceeds DATABASE_POOL_MAX (${poolMaxConnections}) minus ` +
          `${backgroundReserve} background worker slots (max ${maxWorkerConcurrency}). ` +
          'Raise DATABASE_POOL_MAX on the worker service, lower WORKER_CONCURRENCY, or reduce ' +
          'WORKER_BACKGROUND_POOL_SLOT_RESERVE.',
      );
    }

    // Throughput families each run as a separate BullMQ Worker that can hold up to its own
    // concurrency in pooled connections simultaneously. If their combined peak plus the
    // background reserve can exceed the pool, warn so operators can split worker services by
    // queue family or raise the pool before cron overlap / DLQ replay exhausts Postgres.
    const peakThroughputConcurrency =
      getWorkerConcurrencyMail() +
      getWorkerConcurrencyNotify() +
      getWorkerConcurrencyWebhook() +
      getWorkerConcurrencyStripe();
    const peakWorkerPoolDemand = peakThroughputConcurrency + backgroundReserve;
    if (peakWorkerPoolDemand > poolMaxConnections) {
      logger.warn(
        {
          poolMaxConnections,
          backgroundReserve,
          peakThroughputConcurrency,
          peakWorkerPoolDemand,
          mail: getWorkerConcurrencyMail(),
          notify: getWorkerConcurrencyNotify(),
          webhook: getWorkerConcurrencyWebhook(),
          stripe: getWorkerConcurrencyStripe(),
        },
        'database.connection_budget.worker_pool_pressure',
      );
    }
  }
}
