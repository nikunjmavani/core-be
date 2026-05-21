import * as logger from '../logger.util.js';
import type { SetupConfig, SetupSecrets, SetupState, ProviderResult } from '../types.js';

const REDIS_API_BASE = 'https://api.redislabs.com/v1';

function redisHeaders(accountKey: string, secretKey: string): Record<string, string> {
  return {
    'x-api-key': accountKey,
    'x-api-secret-key': secretKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function redisRequest<T>(
  accountKey: string,
  secretKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${REDIS_API_BASE}${path}`, {
    method,
    headers: redisHeaders(accountKey, secretKey),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Redis Cloud API ${method} ${path} failed (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

interface TaskResponse {
  taskId: string;
  commandType: string;
  status: string;
  response?: {
    resourceId?: number;
    error?: { type: string; description: string };
  };
}

interface FixedSubscription {
  id: number;
  name: string;
  status: string;
}

interface FixedDatabase {
  databaseId: number;
  name: string;
  publicEndpoint: string;
  password: string;
  status: string;
}

async function pollTask(
  accountKey: string,
  secretKey: string,
  taskId: string,
  timeoutMs: number = 120000,
): Promise<TaskResponse> {
  const startTime = Date.now();
  const pollIntervalMs = 3000;

  while (Date.now() - startTime < timeoutMs) {
    const task = await redisRequest<TaskResponse>(accountKey, secretKey, 'GET', `/tasks/${taskId}`);

    if (task.status === 'processing-completed') return task;
    if (task.status === 'processing-error') {
      throw new Error(`Redis task failed: ${task.response?.error?.description ?? 'unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Redis task timed out after 120 seconds');
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
  environments: string[],
): Promise<ProviderResult> {
  const { accountKey, secretKey } = secrets.redis;
  const projectName = config.project.name;

  const spinner = logger.startSpinner('Setting up Redis Cloud...');

  try {
    let subscriptionId = state.redis?.subscriptionId;
    const databases: Record<
      string,
      { databaseId: number; publicEndpoint: string; redisUrl: string }
    > = state.redis?.databases ? { ...state.redis.databases } : {};

    // Find or create a fixed subscription
    if (!subscriptionId) {
      const subscriptions = await redisRequest<{ subscriptions: FixedSubscription[] }>(
        accountKey,
        secretKey,
        'GET',
        '/fixed/subscriptions',
      );

      const existingSubscription = subscriptions.subscriptions?.find(
        (subscription) => subscription.name === projectName && subscription.status === 'active',
      );

      if (existingSubscription) {
        subscriptionId = existingSubscription.id;
        logger.stopSpinner(spinner, `Redis subscription found: ${subscriptionId}`);
      } else {
        // Get available plans to find the free/cheapest one
        const plansResponse = await redisRequest<{ plans: Array<{ id: number; name: string }> }>(
          accountKey,
          secretKey,
          'GET',
          '/fixed/plans?provider=AWS&region=us-east-1',
        );

        const freePlan = plansResponse.plans?.find(
          (plan) =>
            plan.name.toLowerCase().includes('free') || plan.name.toLowerCase().includes('30mb'),
        );

        if (!freePlan) {
          throw new Error(
            'No suitable Redis plan found. Check your Redis Cloud account for available plans.',
          );
        }

        const createResponse = await redisRequest<TaskResponse>(
          accountKey,
          secretKey,
          'POST',
          '/fixed/subscriptions',
          { name: projectName, planId: freePlan.id },
        );

        if (createResponse.taskId) {
          const task = await pollTask(accountKey, secretKey, createResponse.taskId);
          subscriptionId = task.response?.resourceId;
        }

        if (!subscriptionId) {
          throw new Error('Failed to get subscription ID from Redis Cloud');
        }

        logger.stopSpinner(spinner, `Redis subscription created: ${subscriptionId}`);
      }
    } else {
      logger.stopSpinner(spinner, `Redis subscription already exists: ${subscriptionId}`);
    }

    // Create databases per environment
    for (const environmentName of environments) {
      if (databases[environmentName]) {
        logger.success(`  Database "${environmentName}" already exists`);
        continue;
      }

      const databaseSpinner = logger.startSpinner(
        `Creating Redis database: ${projectName}-${environmentName}...`,
      );

      const databaseName = `${projectName}-${environmentName}`;

      const createDatabaseResponse = await redisRequest<TaskResponse>(
        accountKey,
        secretKey,
        'POST',
        `/fixed/subscriptions/${subscriptionId}/databases`,
        { name: databaseName },
      );

      let databaseId: number | undefined;

      if (createDatabaseResponse.taskId) {
        const task = await pollTask(accountKey, secretKey, createDatabaseResponse.taskId);
        databaseId = task.response?.resourceId;
      }

      if (!databaseId) {
        throw new Error(`Failed to create Redis database for ${environmentName}`);
      }

      // Fetch database details to get the endpoint
      const databaseDetails = await redisRequest<FixedDatabase>(
        accountKey,
        secretKey,
        'GET',
        `/fixed/subscriptions/${subscriptionId}/databases/${databaseId}`,
      );

      const publicEndpoint = databaseDetails.publicEndpoint;
      const password = databaseDetails.password;
      const redisUrl = `redis://default:${password}@${publicEndpoint}`;

      databases[environmentName] = { databaseId, publicEndpoint, redisUrl };
      logger.stopSpinner(databaseSpinner, `Database "${environmentName}" created: ${databaseId}`);
    }

    return {
      success: true,
      message: `Redis Cloud: ${Object.keys(databases).length} databases ready`,
      stateUpdates: { redis: { subscriptionId: subscriptionId!, databases } },
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.stopSpinner(spinner, `Redis provisioning failed: ${message}`, 'fail');
    return { success: false, message };
  }
}

export async function check(state: SetupState, secrets: SetupSecrets): Promise<boolean> {
  if (!state.redis?.subscriptionId) {
    logger.error('Redis: no subscription in state');
    return false;
  }

  try {
    await redisRequest(
      secrets.redis.accountKey,
      secrets.redis.secretKey,
      'GET',
      `/fixed/subscriptions/${state.redis.subscriptionId}`,
    );
    logger.success(`Redis subscription ${state.redis.subscriptionId} — reachable`);
    return true;
  } catch {
    logger.error(`Redis subscription ${state.redis.subscriptionId} — unreachable`);
    return false;
  }
}

export async function destroy(state: SetupState, secrets: SetupSecrets): Promise<void> {
  if (!state.redis?.subscriptionId || !state.redis.databases) return;

  for (const [environmentName, database] of Object.entries(state.redis.databases)) {
    const spinner = logger.startSpinner(`Deleting Redis database: ${environmentName}...`);
    try {
      await redisRequest(
        secrets.redis.accountKey,
        secrets.redis.secretKey,
        'DELETE',
        `/fixed/subscriptions/${state.redis.subscriptionId}/databases/${database.databaseId}`,
      );
      logger.stopSpinner(spinner, `Redis database "${environmentName}" deleted`);
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
      logger.stopSpinner(
        spinner,
        `Failed to delete Redis database "${environmentName}": ${message}`,
        'fail',
      );
    }
  }
}

export async function destroyEnvironment(
  environmentName: string,
  state: SetupState,
  secrets: SetupSecrets,
): Promise<void> {
  const database = state.redis?.databases?.[environmentName];
  if (!database || !state.redis?.subscriptionId) return;

  const spinner = logger.startSpinner(`Deleting Redis database: ${environmentName}...`);
  try {
    await redisRequest(
      secrets.redis.accountKey,
      secrets.redis.secretKey,
      'DELETE',
      `/fixed/subscriptions/${state.redis.subscriptionId}/databases/${database.databaseId}`,
    );
    logger.stopSpinner(spinner, `Redis database "${environmentName}" deleted`);
  } catch (deleteError) {
    const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
    logger.stopSpinner(
      spinner,
      `Failed to delete Redis database "${environmentName}": ${message}`,
      'fail',
    );
  }
}
