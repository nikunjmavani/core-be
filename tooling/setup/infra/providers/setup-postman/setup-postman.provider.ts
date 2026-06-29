/**
 * Postman provider for `pnpm setup:infra`.
 *
 * Generates the OpenAPI spec and publishes the Postman collection to the configured workspace.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as logger from '@tooling/setup/common/logger.js';
import { isSecretFilled } from '@tooling/setup/common/secrets.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import { resourceStatus } from '@tooling/setup/common/interactive-step.js';
import { buildEnvironmentVariables } from '@tooling/setup/envs/build-env-vars.js';
import { refreshEnvFiles } from '@tooling/setup/envs/export-env-files.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '@tooling/setup/common/types.js';

const POSTMAN_API_BASE = 'https://api.getpostman.com';
// import.meta.dirname is tooling/setup/infra/providers/setup-postman — five levels
// below the repository root.
const PROJECT_ROOT = resolve(import.meta.dirname, '../../../../../');
const COLLECTION_PATH = resolve(PROJECT_ROOT, 'docs', 'postman-collection.json');

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
  if (!(secrets.postman?.apiKey && secrets.postman?.workspaceId)) {
    return { success: true, message: 'Postman: skipped (no API key or workspace ID)' };
  }

  // Refresh .env.<environment> from current state so the subprocess'
  // dotenv loader doesn't override the injected env with stale empty values.
  refreshEnvFiles();

  const spinner = logger.startSpinner('Generating OpenAPI spec and Postman collection...');

  try {
    execSync('pnpm docs:all', {
      cwd: PROJECT_ROOT,
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

    const collectionId = state.postman?.collectionId;
    let method: string;
    let url: string;

    if (collectionId) {
      method = 'PUT';
      url = `${POSTMAN_API_BASE}/collections/${collectionId}`;
    } else {
      method = 'POST';
      url = `${POSTMAN_API_BASE}/collections?workspace=${secrets.postman.workspaceId}`;
    }

    const response = await setupFetch({
      name: 'Postman',
      url,
      init: {
        method,
        headers: {
          'X-Api-Key': secrets.postman.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ collection: collectionData }),
      },
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
      : 'POSTMAN_API_KEY missing in .setup/.setup-credentials',
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
  describe: ({ config }) => ({ project: config.project.name }),
  inspectRemote: async ({ config, secrets }) => {
    if (!config.providers.postman.enabled) {
      return { present: false, fields: [], error: 'disabled in setup.config.json' };
    }
    const apiKey = secrets.postman?.apiKey ?? '';
    if (!apiKey)
      return {
        present: false,
        fields: [],
        error: 'POSTMAN_API_KEY missing in .setup/.setup-credentials',
      };
    const workspaceId = secrets.postman?.workspaceId;
    try {
      const url = workspaceId
        ? `${POSTMAN_API_BASE}/collections?workspace=${workspaceId}`
        : `${POSTMAN_API_BASE}/collections`;
      const response = await setupFetch({
        name: 'Postman',
        url,
        init: { headers: { 'X-Api-Key': apiKey } },
      });
      if (!response.ok)
        return { present: false, fields: [], error: `Postman API returned ${response.status}` };
      const body = (await response.json()) as { collections?: Array<{ name?: string }> };
      const expected = config.project.name;
      const collection = body.collections?.find((entry) => entry.name === expected);
      return {
        present: Boolean(collection),
        fields: [
          {
            label: 'collection',
            expected,
            remote:
              collection?.name ?? (body.collections?.length ? '(other collections exist)' : '—'),
            matches: Boolean(collection),
          },
        ],
      };
    } catch (error) {
      return {
        present: false,
        fields: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  buildStep: (context: InfraProviderContext) => ({
    name: 'Postman',
    enabled: setupPostmanProvider.isEnabled(context),
    enabledReason: setupPostmanProvider.disabledReason(context),
    instructions: [
      'Will generate the OpenAPI spec, convert to Postman Collection, and upload to your workspace.',
      'Idempotent: an existing collection is updated; otherwise a new one is created.',
    ],
    detectStatus: () =>
      resourceStatus(Boolean(context.state.postman?.collectionId), 'Postman collection uploaded'),
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
