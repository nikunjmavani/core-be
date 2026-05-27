import { randomBytes } from 'node:crypto';
import * as logger from '../../../common/logger.js';
import { isSecretFilled } from '../../../common/secrets.js';
import type {
  InfraProvider,
  InfraProviderContext,
  ProviderResult,
  SetupConfig,
  SetupSecrets,
  SetupState,
} from '../../../common/types.js';

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';
const REDIS_SERVICE_NAME = 'redis';
const REDIS_PORT = 6379;
/**
 * Railway resolves `<service-name>.railway.internal` per-environment via its
 * internal DNS: api/worker in `production` reach the `production` redis, and
 * `development` reaches the `development` redis. Same hostname string, scoped
 * resolution. This URL is only routable inside Railway's WireGuard mesh — local
 * `pnpm dev` cannot reach it (see docs/deployment/runbooks/redis-topology.md).
 */
const REDIS_PRIVATE_HOSTNAME = `${REDIS_SERVICE_NAME}.railway.internal`;

interface RailwayRedisInstance {
  environmentName: string;
  environmentId: string;
  serviceId: string;
  redisUrl: string;
  privateEndpoint: string;
}

async function railwayGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Railway GraphQL failed (${response.status}): ${errorBody}`);
  }

  const result = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (result.errors?.length) {
    throw new Error(
      `Railway GraphQL errors: ${result.errors.map((error) => error.message).join(', ')}`,
    );
  }

  return result.data as T;
}

function generateRedisPassword(): string {
  return randomBytes(32).toString('hex');
}

function isGeneratedRedisPassword(redisPassword: string): boolean {
  return /^[0-9a-f]{64}$/i.test(redisPassword);
}

function buildValkeyStartCommand(maxmemoryMb: number): string {
  return [
    'valkey-server',
    '--bind 0.0.0.0',
    `--port ${REDIS_PORT}`,
    '--protected-mode yes',
    '--requirepass "$REDIS_PASSWORD"',
    `--maxmemory ${maxmemoryMb}mb`,
    '--maxmemory-policy noeviction',
    '--appendonly no',
    '--save ""',
  ].join(' ');
}

function buildRailwayRedisUrl(redisPassword: string): string {
  return `redis://default:${encodeURIComponent(redisPassword)}@${REDIS_PRIVATE_HOSTNAME}:${REDIS_PORT}`;
}

function buildRailwayPrivateEndpoint(): string {
  return `${REDIS_PRIVATE_HOSTNAME}:${REDIS_PORT}`;
}

/**
 * Reads the password back from a previously-recorded REDIS_URL only when it
 * matches this provider's generated secret format. Legacy template URLs and
 * opaque provider-returned secret placeholders are rejected so reruns rotate to
 * a known plaintext value that can be embedded into REDIS_URL.
 */
function getExistingRedisPassword(state: SetupState, environmentName: string): string | undefined {
  const redisUrl = state.redis?.databases?.[environmentName]?.redisUrl;
  if (!redisUrl) return undefined;
  if (redisUrl.includes('${{')) return undefined;
  try {
    const url = new URL(redisUrl);
    const password = decodeURIComponent(url.password);
    return isGeneratedRedisPassword(password) ? password : undefined;
  } catch {
    return undefined;
  }
}

function getRedisServiceState(
  state: SetupState,
  environmentName: string,
): { environmentId: string; serviceId: string } | undefined {
  const environmentState = state.railway?.environments?.[environmentName];
  const redisServiceState = environmentState?.services[REDIS_SERVICE_NAME];
  if (!(environmentState && redisServiceState?.serviceId)) return undefined;
  return {
    environmentId: redisServiceState.environmentId ?? environmentState.environmentId,
    serviceId: redisServiceState.serviceId,
  };
}

async function upsertVariables(options: {
  token: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  variables: Record<string, string>;
}): Promise<void> {
  await railwayGraphQL<{ variableCollectionUpsert: boolean | null }>(
    options.token,
    `
    mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `,
    {
      input: {
        projectId: options.projectId,
        environmentId: options.environmentId,
        serviceId: options.serviceId,
        variables: options.variables,
        replace: false,
      },
    },
  );
}

async function configureRedisService(options: {
  token: string;
  serviceId: string;
  environmentId: string;
  config: SetupConfig['providers']['railwayRedis'];
}): Promise<void> {
  await railwayGraphQL<{ serviceInstanceUpdate: boolean | null }>(
    options.token,
    `
    mutation ServiceInstanceUpdate(
      $serviceId: String!
      $environmentId: String!
      $input: ServiceInstanceUpdateInput!
    ) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }
  `,
    {
      serviceId: options.serviceId,
      environmentId: options.environmentId,
      input: {
        source: { image: options.config.image },
        startCommand: buildValkeyStartCommand(options.config.maxmemoryMb),
        multiRegionConfig: {
          [options.config.region]: { numReplicas: 1 },
        },
      },
    },
  );
}

async function deployRedisService(options: {
  token: string;
  serviceId: string;
  environmentId: string;
}): Promise<void> {
  await railwayGraphQL<{ serviceInstanceDeployV2: string | null }>(
    options.token,
    `
    mutation ServiceInstanceDeployV2($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }
  `,
    {
      serviceId: options.serviceId,
      environmentId: options.environmentId,
    },
  );
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
  environments: string[],
): Promise<ProviderResult> {
  if (!isSecretFilled(secrets.railway.token)) {
    return { success: false, message: 'Railway Redis: RAILWAY_TOKEN must be set in .env.setup.' };
  }
  if (!state.railway?.projectId) {
    return {
      success: false,
      message: 'Railway Redis: Railway project state missing. Run the Railway provider first.',
    };
  }

  const databases: NonNullable<SetupState['redis']>['databases'] = {
    ...(state.redis?.databases ?? {}),
  };
  const instances: RailwayRedisInstance[] = [];

  for (const environmentName of environments) {
    const serviceState = getRedisServiceState(state, environmentName);
    if (!serviceState) {
      return {
        success: false,
        message: `Railway Redis: redis service is not attached to environment "${environmentName}". Run the Railway provider first.`,
      };
    }

    const redisPassword =
      getExistingRedisPassword(state, environmentName) ?? generateRedisPassword();
    const spinner = logger.startSpinner(`Configuring Railway Redis (${environmentName})...`);

    try {
      await upsertVariables({
        token: secrets.railway.token,
        projectId: state.railway.projectId,
        environmentId: serviceState.environmentId,
        serviceId: serviceState.serviceId,
        variables: {
          REDIS_PASSWORD: redisPassword,
        },
      });
      await configureRedisService({
        token: secrets.railway.token,
        serviceId: serviceState.serviceId,
        environmentId: serviceState.environmentId,
        config: config.providers.railwayRedis,
      });
      await deployRedisService({
        token: secrets.railway.token,
        serviceId: serviceState.serviceId,
        environmentId: serviceState.environmentId,
      });

      const redisUrl = buildRailwayRedisUrl(redisPassword);
      const privateEndpoint = buildRailwayPrivateEndpoint();
      instances.push({
        environmentName,
        environmentId: serviceState.environmentId,
        serviceId: serviceState.serviceId,
        redisUrl,
        privateEndpoint,
      });
      databases[environmentName] = {
        databaseId: `${serviceState.serviceId}:${serviceState.environmentId}`,
        publicEndpoint: privateEndpoint,
        redisUrl,
      };

      logger.stopSpinner(
        spinner,
        `Railway Redis (${environmentName}) configured with ${config.providers.railwayRedis.maxmemoryMb} MB maxmemory`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.stopSpinner(spinner, `Railway Redis (${environmentName}) failed: ${message}`, 'fail');
      return {
        success: false,
        message,
        stateUpdates: {
          redis: {
            subscriptionId: 0,
            databases,
          },
        },
      };
    }
  }

  return {
    success: true,
    message: `Railway Redis: ${instances.length} service instance(s) ready`,
    stateUpdates: {
      redis: {
        subscriptionId: 0,
        databases,
      },
    },
  };
}

function allEnvironmentsHaveRedis(environments: string[], state: SetupState): boolean {
  if (!state.redis?.databases) return false;
  return environments.every((environmentName) => {
    const database = state.redis?.databases?.[environmentName];
    const serviceState = getRedisServiceState(state, environmentName);
    if (!(serviceState?.serviceId && database?.redisUrl)) return false;
    if (database.databaseId !== `${serviceState.serviceId}:${serviceState.environmentId}`) {
      return false;
    }
    if (database.redisUrl.includes('${{')) return false;
    const redisPassword = getExistingRedisPassword(state, environmentName);
    return Boolean(redisPassword && database.redisUrl.includes(`@${REDIS_PRIVATE_HOSTNAME}:`));
  });
}

export const setupRailwayRedisProvider: InfraProvider = {
  key: 'railway-redis',
  name: 'Railway Redis',
  isEnabled: ({ config, secrets }) =>
    config.providers.railwayRedis.enabled && isSecretFilled(secrets.railway.token),
  disabledReason: ({ config }) =>
    !config.providers.railwayRedis.enabled
      ? 'disabled in setup.config.json'
      : 'RAILWAY_TOKEN missing in .env.setup',
  preview: ({ config }) =>
    config.providers.railwayRedis.enabled
      ? {
          detail: `${config.providers.railwayRedis.image} in ${config.providers.railwayRedis.region}, ${config.providers.railwayRedis.maxmemoryMb} MB maxmemory`,
          url: 'https://railway.app/account/tokens',
          configKey: 'RAILWAY_TOKEN',
        }
      : null,
  settingsReview: ({ config, environments }) =>
    config.providers.railwayRedis.enabled
      ? [
          {
            bucket: 'resource',
            provider: 'Railway Redis',
            detail: `${environments.length} Valkey-backed Redis service instance(s), ${config.providers.railwayRedis.maxmemoryMb} MB maxmemory, region ${config.providers.railwayRedis.region}`,
          },
        ]
      : [],
  buildStep: (context: InfraProviderContext) => ({
    name: 'Railway Redis',
    enabled: setupRailwayRedisProvider.isEnabled(context),
    enabledReason: setupRailwayRedisProvider.disabledReason(context),
    instructions: [
      `Will configure the Railway "${REDIS_SERVICE_NAME}" service in each environment with ${context.config.providers.railwayRedis.image}.`,
      `Will set REDIS_PASSWORD on the Redis service and write REDIS_URL with Railway private-network references for: ${context.environments.join(', ')}.`,
      `Will set Valkey maxmemory to ${context.config.providers.railwayRedis.maxmemoryMb} MB and deploy in ${context.config.providers.railwayRedis.region}.`,
    ],
    alreadyDone: () => allEnvironmentsHaveRedis(context.environments, context.state),
    alreadyDoneMessage:
      'all environments already have Railway Redis service attachments and Redis URLs in state',
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
  check: ({ state, environments }) =>
    Promise.resolve(allEnvironmentsHaveRedis(environments, state)),
  deleteInstructions: ({ state }) => {
    const databases = state.redis?.databases;
    if (!databases || Object.keys(databases).length === 0) return [];
    return [
      {
        provider: 'Railway Redis',
        dashboardUrl: state.railway?.projectId
          ? `https://railway.app/project/${state.railway.projectId}`
          : 'https://railway.app/dashboard',
        steps: [
          'Open the Railway project and select the redis service.',
          'Delete the redis service, or delete the whole project if setup:infra created it only for this app.',
        ],
        resources: Object.entries(databases).map(([environmentName, database]) => ({
          label: `Redis service instance (${environmentName})`,
          identifier: String(database.databaseId),
        })),
      },
    ];
  },
};
