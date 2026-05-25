import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as logger from '../../../common/logger.js';
import { isSecretFilled } from '../../../common/secrets.js';
import { buildEnvironmentVariables } from '../../../envs/build-env-vars.js';
import { refreshEnvFiles } from '../../../envs/export-env-files.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

const POSTMAN_API_BASE = 'https://api.getpostman.com';
const COLLECTION_PATH = resolve(import.meta.dirname, '../../../../docs/postman-collection.json');

function toProcessEnvironment(
  variables: ReturnType<typeof buildEnvironmentVariables>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'string' && value.length > 0) {
      environment[key] = value;
    }
  }
  return environment;
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
): Promise<ProviderResult> {
  if (!secrets.postman?.apiKey || !secrets.postman?.workspaceId) {
    return { success: true, message: 'Postman: skipped (no API key or workspace ID)' };
  }

  // Refresh .env.<environment> from current state so the subprocess'
  // dotenv loader doesn't override the injected env with stale empty values.
  refreshEnvFiles();

  const spinner = logger.startSpinner('Generating OpenAPI spec and Postman collection...');

  try {
    execSync('pnpm docs:all', {
      cwd: resolve(import.meta.dirname, '../../../../'),
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000,
      env: toProcessEnvironment(
        buildEnvironmentVariables(
          config.environments.find((environment) => environment.isDefault)?.name ??
            config.environments[0]?.name ??
            'development',
          config,
          secrets,
          state,
        ),
      ),
    });

    logger.stopSpinner(spinner, 'OpenAPI spec and Postman collection generated');

    if (!existsSync(COLLECTION_PATH)) {
      logger.warn('Postman collection file not found — skipping upload');
      return {
        success: true,
        message: 'Postman: collection generated but file not found for upload',
      };
    }

    // Upload to Postman
    const uploadSpinner = logger.startSpinner('Uploading collection to Postman...');

    const collectionContent = readFileSync(COLLECTION_PATH, 'utf-8');
    const collectionData = JSON.parse(collectionContent);

    let collectionId = state.postman?.collectionId;
    let method: string;
    let url: string;

    if (collectionId) {
      method = 'PUT';
      url = `${POSTMAN_API_BASE}/collections/${collectionId}`;
    } else {
      method = 'POST';
      url = `${POSTMAN_API_BASE}/collections?workspace=${secrets.postman.workspaceId}`;
    }

    const response = await fetch(url, {
      method,
      headers: {
        'X-Api-Key': secrets.postman.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ collection: collectionData }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Postman API ${method} failed (${response.status}): ${errorBody}`);
    }

    const responseData = (await response.json()) as { collection?: { uid?: string } };
    const newCollectionId = responseData.collection?.uid;

    logger.stopSpinner(
      uploadSpinner,
      `Postman collection uploaded${newCollectionId ? `: ${newCollectionId}` : ''}`,
    );

    if (newCollectionId) {
      return {
        success: true,
        message: 'Postman: collection uploaded',
        stateUpdates: { postman: { collectionId: newCollectionId } },
      };
    }
    return {
      success: true,
      message: 'Postman: collection uploaded',
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.error(`Postman provisioning failed: ${message}`);
    return { success: false, message };
  }
}

export const setupPostmanProvider: InfraProvider = {
  key: 'postman',
  name: 'Postman',
  isEnabled: ({ config, secrets }) =>
    config.providers.postman.enabled && isSecretFilled(secrets.postman?.apiKey),
  disabledReason: ({ config }) =>
    !config.providers.postman.enabled
      ? 'disabled in setup.config.json'
      : 'POSTMAN_API_KEY missing in .env.setup',
  preview: ({ config }) =>
    config.providers.postman.enabled
      ? {
          detail: 'API key + Workspace ID',
          url: 'https://go.postman.co/settings/me/api-keys',
          configKey: 'postman.apiKey, postman.workspaceId',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.postman.enabled
      ? [{ bucket: 'extra', provider: 'Postman', detail: 'upload collection' }]
      : [],
  buildStep: (context: InfraProviderContext) => ({
    name: 'Postman',
    enabled: setupPostmanProvider.isEnabled(context),
    enabledReason: setupPostmanProvider.disabledReason(context),
    instructions: [
      'Will generate the OpenAPI spec, convert to Postman Collection, and upload to your workspace.',
      'Idempotent: an existing collection is updated; otherwise a new one is created.',
    ],
    alreadyDone: () => Boolean(context.state.postman?.collectionId),
    alreadyDoneMessage: 'Postman collection already uploaded',
    execute: async () => {
      const result = await provision(context.config, context.secrets, context.state);
      context.applyStateUpdates(result.stateUpdates ?? {});
      if (!result.success) throw new Error(result.message);
      return result;
    },
  }),
  deleteInstructions: ({ state }) => {
    if (!state.postman?.collectionId) return [];
    return [
      {
        provider: 'Postman',
        dashboardUrl: 'https://go.postman.co/collections',
        steps: [
          'Open the workspace, locate the collection by UID.',
          'Right-click → Delete (or open the collection → ⋯ → Delete).',
        ],
        resources: [{ label: 'Collection UID', identifier: state.postman.collectionId }],
      },
    ];
  },
};
