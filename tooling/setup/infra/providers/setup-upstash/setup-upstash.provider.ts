import { isSecretFilled } from '../../../common/secrets.js';
import * as logger from '../../../common/logger.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

/**
 * Upstash Redis: provisions one Redis database per environment using the
 * Upstash REST API. Auth is `UPSTASH_EMAIL` + `UPSTASH_API_KEY` from
 * `.env.setup` (Basic auth). Existing databases (matching the per-environment
 * name) are adopted, never re-created. When the API refuses to create more
 * databases (plan limit) the step fails with a clear message so the operator
 * upgrades their Upstash plan and re-runs.
 */
const UPSTASH_API_BASE = 'https://api.upstash.com/v2';
const UPSTASH_PRIMARY_REGION = 'us-east-1';

interface UpstashDatabaseResponse {
  database_id: string;
  database_name: string;
  endpoint: string;
  port: number;
  password: string;
  tls?: boolean;
}

function databaseNameFor(config: SetupConfig, environmentName: string): string {
  return `${config.project.name}-${environmentName}`;
}

function buildRedisUrl(database: UpstashDatabaseResponse): string {
  const protocol = database.tls === false ? 'redis' : 'rediss';
  return `${protocol}://default:${database.password}@${database.endpoint}:${database.port}`;
}

function upstashHeaders(secrets: SetupSecrets): Record<string, string> {
  const authorization = Buffer.from(`${secrets.upstash.email}:${secrets.upstash.apiKey}`).toString(
    'base64',
  );
  return {
    Authorization: `Basic ${authorization}`,
    'Content-Type': 'application/json',
  };
}

async function upstashRequest<T>(
  secrets: SetupSecrets,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | string }> {
  const init: RequestInit = {
    method,
    headers: upstashHeaders(secrets),
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${UPSTASH_API_BASE}${path}`, init);
  const text = await response.text();
  let data: T | string = text;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text;
    }
  }
  return { status: response.status, data };
}

async function listDatabases(secrets: SetupSecrets): Promise<UpstashDatabaseResponse[]> {
  const { status, data } = await upstashRequest<UpstashDatabaseResponse[]>(
    secrets,
    'GET',
    '/redis/databases',
  );
  if (status !== 200) {
    throw new Error(
      `Upstash API GET /redis/databases failed (${status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`,
    );
  }
  return Array.isArray(data) ? data : [];
}

async function getDatabase(
  secrets: SetupSecrets,
  databaseId: string,
): Promise<UpstashDatabaseResponse> {
  const { status, data } = await upstashRequest<UpstashDatabaseResponse>(
    secrets,
    'GET',
    `/redis/database/${databaseId}`,
  );
  if (status !== 200 || typeof data === 'string') {
    throw new Error(
      `Upstash API GET /redis/database/${databaseId} failed (${status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`,
    );
  }
  return data;
}

async function createDatabase(
  secrets: SetupSecrets,
  name: string,
): Promise<UpstashDatabaseResponse> {
  const { status, data } = await upstashRequest<UpstashDatabaseResponse>(
    secrets,
    'POST',
    '/redis/database',
    {
      database_name: name,
      region: 'global',
      primary_region: UPSTASH_PRIMARY_REGION,
      tls: true,
    },
  );
  if (status === 200 || status === 201) {
    if (typeof data === 'string') {
      throw new Error(`Upstash create returned non-JSON body: ${data}`);
    }
    return data;
  }
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  const looksLikePlanLimit = /cannot have more than|plan|payment|quota|limit|upgrade/i.test(body);
  if (looksLikePlanLimit) {
    throw new Error(
      `Upstash refused to create "${name}" — please check your Upstash plan, ` +
        `the API reports this resource isn't allowed to create. Upstash said: ${body}`,
    );
  }
  throw new Error(`Upstash API POST /redis/database failed (${status}): ${body}`);
}

async function ensureDatabaseForEnvironment(
  secrets: SetupSecrets,
  existing: UpstashDatabaseResponse[],
  name: string,
): Promise<{ database: UpstashDatabaseResponse; adopted: boolean }> {
  const match = existing.find((entry) => entry.database_name === name);
  if (match) {
    if (!match.password || !match.endpoint) {
      const full = await getDatabase(secrets, match.database_id);
      return { database: full, adopted: true };
    }
    return { database: match, adopted: true };
  }
  const created = await createDatabase(secrets, name);
  return { database: created, adopted: false };
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
  environments: string[],
): Promise<ProviderResult> {
  if (!isSecretFilled(secrets.upstash.email) || !isSecretFilled(secrets.upstash.apiKey)) {
    return {
      success: false,
      message: 'Upstash: UPSTASH_EMAIL and UPSTASH_API_KEY must be set in .env.setup.',
    };
  }

  const spinner = logger.startSpinner('Listing Upstash Redis databases...');
  let existingDatabases: UpstashDatabaseResponse[];
  try {
    existingDatabases = await listDatabases(secrets);
    logger.stopSpinner(spinner, `Upstash: found ${existingDatabases.length} existing database(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.stopSpinner(spinner, `Upstash list failed: ${message}`, 'fail');
    return { success: false, message };
  }

  const databases: Record<
    string,
    { databaseId: string; publicEndpoint: string; redisUrl: string }
  > = {};
  for (const [environmentName, entry] of Object.entries(state.redis?.databases ?? {})) {
    databases[environmentName] = {
      databaseId: String(entry.databaseId),
      publicEndpoint: entry.publicEndpoint,
      redisUrl: entry.redisUrl,
    };
  }

  let firstFailure: string | undefined;

  for (const environmentName of environments) {
    const expectedName = databaseNameFor(config, environmentName);
    const stepSpinner = logger.startSpinner(`Upstash "${environmentName}" (${expectedName})...`);
    try {
      const { database, adopted } = await ensureDatabaseForEnvironment(
        secrets,
        existingDatabases,
        expectedName,
      );
      databases[environmentName] = {
        databaseId: String(database.database_id),
        publicEndpoint: database.endpoint,
        redisUrl: buildRedisUrl(database),
      };
      logger.stopSpinner(
        stepSpinner,
        `Upstash "${environmentName}" ${adopted ? 'adopted' : 'created'}: ${database.database_name}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.stopSpinner(stepSpinner, `Upstash "${environmentName}" failed: ${message}`, 'fail');
      firstFailure ??= message;
    }
  }

  const stateUpdates: Partial<SetupState> =
    Object.keys(databases).length > 0 ? { redis: { subscriptionId: 0, databases } } : {};

  if (firstFailure) {
    return { success: false, message: firstFailure, stateUpdates };
  }

  return {
    success: true,
    message: `Upstash: ${Object.keys(databases).length} database(s) ready`,
    stateUpdates,
  };
}

export async function check(_state: SetupState, _secrets: SetupSecrets): Promise<boolean> {
  return true;
}

function allEnvironmentsHaveRedis(environments: string[], state: SetupState): boolean {
  if (!state.redis?.databases) return false;
  return environments.every((environmentName) =>
    Boolean(state.redis?.databases?.[environmentName]?.redisUrl),
  );
}

export const setupUpstashProvider: InfraProvider = {
  key: 'upstash',
  name: 'Upstash Redis',
  isEnabled: ({ config, secrets }) =>
    config.providers.upstash.enabled &&
    isSecretFilled(secrets.upstash.email) &&
    isSecretFilled(secrets.upstash.apiKey),
  disabledReason: ({ config }) =>
    !config.providers.upstash.enabled
      ? 'disabled in setup.config.json'
      : 'UPSTASH_EMAIL + UPSTASH_API_KEY missing in .env.setup',
  preview: ({ config }) =>
    config.providers.upstash.enabled
      ? {
          detail: 'one Redis database per environment',
          url: 'https://console.upstash.com/account/api',
          configKey: 'UPSTASH_EMAIL + UPSTASH_API_KEY',
        }
      : null,
  settingsReview: ({ config, environments }) =>
    config.providers.upstash.enabled
      ? [
          {
            bucket: 'resource',
            provider: 'Upstash Redis',
            detail: `${environments.length} Redis database(s) (${environments
              .map((environmentName) => `${config.project.name}-${environmentName}`)
              .join(', ')})`,
          },
        ]
      : [],
  detectExisting: async ({ config, secrets }) => {
    if (
      !config.providers.upstash.enabled ||
      !isSecretFilled(secrets.upstash.email) ||
      !isSecretFilled(secrets.upstash.apiKey)
    ) {
      return [];
    }
    try {
      const databases = await listDatabases(secrets);
      return databases
        .filter((database) => database.database_name.startsWith(`${config.project.name}-`))
        .map((database) => ({
          provider: 'Upstash Redis',
          detail: `database "${database.database_name}" already exists (${database.database_id})`,
        }));
    } catch {
      return [];
    }
  },
  buildStep: (context: InfraProviderContext) => ({
    name: 'Upstash Redis',
    enabled: setupUpstashProvider.isEnabled(context),
    enabledReason: setupUpstashProvider.disabledReason(context),
    instructions: [
      `Will adopt or create one Upstash Redis database per environment (${context.environments
        .map((environmentName) => `${context.config.project.name}-${environmentName}`)
        .join(', ')}).`,
      'If Upstash refuses to create a new database (plan limit), the step fails with the upstream message — upgrade your Upstash plan and re-run.',
    ],
    alreadyDone: () => allEnvironmentsHaveRedis(context.environments, context.state),
    alreadyDoneMessage: 'all environments already have a Redis URL in state',
    execute: async () => {
      const result = await provision(
        context.config,
        context.secrets,
        context.state,
        context.environments,
      );
      if (result.stateUpdates && Object.keys(result.stateUpdates).length > 0) {
        context.applyStateUpdates(result.stateUpdates);
      }
      if (!result.success) throw new Error(result.message);
      return result;
    },
    verifyState: () => ({
      ok: allEnvironmentsHaveRedis(context.environments, context.state),
      message: context.state.redis
        ? `Redis URL recorded for ${Object.keys(context.state.redis.databases).length} environment(s)`
        : 'no Redis state recorded',
    }),
  }),
  check: ({ state, secrets }) => check(state, secrets),
  deleteInstructions: ({ state }) => {
    const databases = state.redis?.databases;
    if (!databases || Object.keys(databases).length === 0) return [];
    return [
      {
        provider: 'Upstash Redis',
        dashboardUrl: 'https://console.upstash.com/redis',
        steps: [
          'Open the dashboard above and locate each database below.',
          'Click the database → Danger Zone → Delete database.',
        ],
        resources: Object.entries(databases).map(([environmentName, database]) => ({
          label: `Database (${environmentName})`,
          identifier: database.databaseId,
        })),
      },
    ];
  },
};
