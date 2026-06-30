/**
 * Postman provider for `pnpm setup:infra`.
 *
 * One input only — POSTMAN_API_KEY (prompted at apply, stored in .env.<environment>). The script
 * then does everything via the Postman API: finds or CREATES a workspace named after the project
 * (`POST /workspaces`), generates the OpenAPI + Postman collection, and uploads it into that
 * workspace. No POSTMAN_WORKSPACE_ID input — the workspace id is created/resolved and recorded.
 *
 * Postman teams/organizations are NOT API-creatable (dashboard/billing-level); the API token is
 * issued under your existing account/team, and everything below it (workspace + collection) is
 * created here.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: prompted from stdin, written to `.env.<environment>` only, never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resourceStatus } from '@tooling/setup/common/interactive-step.js';
import * as logger from '@tooling/setup/common/logger.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import type {
  InfraProvider,
  InfraProviderContext,
  ProviderResult,
  SetupConfig,
  SetupSecrets,
  SetupState,
} from '@tooling/setup/common/types.js';
import { buildEnvironmentVariables } from '@tooling/setup/envs/build-env-vars.js';
import {
  anyEnvironmentHasEnvKey,
  collectEnvCredentials,
  resolveDefaultEnvironmentName,
} from '@tooling/setup/envs/env-file-setup.util.js';
import { exportEnvFiles } from '@tooling/setup/envs/export-env-files.js';
import { readEnvFileValue, upsertEnvFileValue } from '@tooling/setup/envs/read-env-file.js';

const POSTMAN_API_BASE = 'https://api.getpostman.com';
const API_KEYS_URL = 'https://go.postman.co/settings/me/api-keys';
// import.meta.dirname is tooling/setup/infra/providers/setup-postman — five levels below root.
const PROJECT_ROOT = resolve(import.meta.dirname, '../../../../../');
const COLLECTION_PATH = resolve(PROJECT_ROOT, 'docs', 'postman-collection.json');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Call the Postman API (X-Api-Key auth) and parse JSON; throws with the body on non-2xx. */
async function postmanApi<T>(
  apiKey: string,
  path: string,
  init?: { method?: string; body?: string },
): Promise<T> {
  const method = init?.method ?? 'GET';
  const response = await setupFetch({
    name: 'Postman',
    url: `${POSTMAN_API_BASE}${path}`,
    init: {
      method,
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      ...(init?.body ? { body: init.body } : {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Postman API ${method} ${path} failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

/** Adopt the workspace named after the project (by id or name), else create a personal one. */
async function findOrCreateWorkspace(
  apiKey: string,
  name: string,
  knownId: string | undefined,
): Promise<{ id: string; created: boolean }> {
  const list = await postmanApi<{ workspaces: Array<{ id: string; name: string }> }>(
    apiKey,
    '/workspaces',
  );
  const existing = list.workspaces.find(
    (workspace) => (knownId && workspace.id === knownId) || workspace.name === name,
  );
  if (existing) return { id: existing.id, created: false };
  const created = await postmanApi<{ workspace: { id: string } }>(apiKey, '/workspaces', {
    method: 'POST',
    body: JSON.stringify({ workspace: { name, type: 'personal' } }),
  });
  return { id: created.workspace.id, created: true };
}

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
  const defaultEnvironmentName = resolveDefaultEnvironmentName(config);
  const apiKey = readEnvFileValue(defaultEnvironmentName, 'POSTMAN_API_KEY');
  if (!apiKey) {
    return {
      success: true,
      message: `Postman: skipped (POSTMAN_API_KEY missing in .env.${defaultEnvironmentName})`,
    };
  }

  // 1) Find or create the workspace (named after the project) — no workspace id input needed.
  const workspaceName = config.project.name;
  let workspaceId: string;
  try {
    const workspace = await findOrCreateWorkspace(
      apiKey,
      workspaceName,
      state.postman?.workspaceId,
    );
    workspaceId = workspace.id;
    logger.success(
      `  Postman workspace "${workspaceName}" — ${workspace.created ? 'created' : 'adopted'} (${workspaceId})`,
    );
  } catch (error) {
    return { success: false, message: `Postman: workspace setup failed — ${errorMessage(error)}` };
  }
  // Record the resolved workspace id back into each env file (it is an output, not an input).
  for (const environment of config.environments) {
    upsertEnvFileValue(environment.name, 'POSTMAN_WORKSPACE_ID', workspaceId);
  }

  // 2) Generate the OpenAPI spec + Postman collection (subprocess sees fresh, preserved env).
  exportEnvFiles();
  const spinner = logger.startSpinner('Generating OpenAPI spec and Postman collection...');
  try {
    execSync('pnpm docs:all', {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000,
      env: toProcessEnvironment(
        buildEnvironmentVariables(defaultEnvironmentName, config, secrets, state),
      ),
    });
    logger.stopSpinner(spinner, 'OpenAPI spec and Postman collection generated');
  } catch (error) {
    logger.stopSpinner(spinner, 'Postman collection generation failed', 'fail');
    return { success: false, message: `Postman: ${errorMessage(error)}` };
  }

  if (!existsSync(COLLECTION_PATH)) {
    logger.warn('Postman collection file not found — skipping upload');
    return {
      success: true,
      message: 'Postman: workspace ready but collection file not found for upload',
      stateUpdates: { postman: { workspaceId } },
    };
  }

  // 3) Create (POST into the workspace) or update (PUT by uid) the collection.
  try {
    const collectionData = JSON.parse(readFileSync(COLLECTION_PATH, 'utf-8'));
    const knownCollectionId = state.postman?.collectionId;
    const { method, path } = knownCollectionId
      ? { method: 'PUT', path: `/collections/${knownCollectionId}` }
      : { method: 'POST', path: `/collections?workspace=${workspaceId}` };

    const uploadSpinner = logger.startSpinner('Uploading collection to Postman...');
    const result = await postmanApi<{ collection?: { uid?: string } }>(apiKey, path, {
      method,
      body: JSON.stringify({ collection: collectionData }),
    });
    const collectionId = result.collection?.uid ?? knownCollectionId;
    logger.stopSpinner(
      uploadSpinner,
      `Postman collection uploaded${collectionId ? `: ${collectionId}` : ''}`,
    );

    return {
      success: true,
      message: 'Postman: workspace + collection provisioned',
      stateUpdates: { postman: { workspaceId, ...(collectionId ? { collectionId } : {}) } },
    };
  } catch (error) {
    return { success: false, message: `Postman: ${errorMessage(error)}` };
  }
}

export const setupPostmanProvider: InfraProvider = {
  key: 'postman',
  name: 'Postman',
  isEnabled: ({ config }) =>
    config.providers.postman.enabled && anyEnvironmentHasEnvKey(config, 'POSTMAN_API_KEY'),
  disabledReason: ({ config }) =>
    !config.providers.postman.enabled
      ? 'disabled in setup.config.json'
      : 'POSTMAN_API_KEY missing in .env.<environment>',
  preview: ({ config }) =>
    config.providers.postman.enabled
      ? {
          detail: 'Creates the workspace + uploads the collection (one API key)',
          url: API_KEYS_URL,
          configKey: '.env.<environment> → POSTMAN_API_KEY',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.postman.enabled
      ? [{ bucket: 'resource', provider: 'Postman', detail: 'workspace + collection' }]
      : [],
  describe: ({ config }) => ({ project: config.project.name }),
  inspectRemote: async ({ config }) => {
    if (!config.providers.postman.enabled) {
      return { present: false, fields: [], error: 'disabled in setup.config.json' };
    }
    const defaultEnvironmentName = resolveDefaultEnvironmentName(config);
    const apiKey = readEnvFileValue(defaultEnvironmentName, 'POSTMAN_API_KEY');
    if (!apiKey) {
      return {
        present: false,
        fields: [],
        error: `POSTMAN_API_KEY missing in .env.${defaultEnvironmentName}`,
      };
    }
    try {
      const list = await postmanApi<{ workspaces: Array<{ id: string; name: string }> }>(
        apiKey,
        '/workspaces',
      );
      const expected = config.project.name;
      const workspace = list.workspaces.find((entry) => entry.name === expected);
      return {
        present: Boolean(workspace),
        fields: [
          {
            label: 'workspace',
            expected,
            remote: workspace?.name ?? (list.workspaces.length ? '(other workspaces exist)' : '—'),
            matches: Boolean(workspace),
          },
        ],
      };
    } catch (error) {
      return { present: false, fields: [], error: errorMessage(error) };
    }
  },
  buildStep: (context: InfraProviderContext) => ({
    name: 'Postman',
    enabled: setupPostmanProvider.isEnabled(context),
    enabledReason: setupPostmanProvider.disabledReason(context),
    instructions: [
      `Create a Postman API key: ${API_KEYS_URL} (any plan — a personal key is fine).`,
      'Paste it below when prompted (hidden) — saved to each .env.<environment> as POSTMAN_API_KEY.',
      `Setup then CREATES a workspace named "${context.config.project.name}" (if absent) and uploads`,
      'the generated OpenAPI/Postman collection into it. No workspace ID needed.',
      'Idempotent: an existing workspace/collection is reused and updated.',
    ],
    detectStatus: () =>
      resourceStatus(Boolean(context.state.postman?.collectionId), 'Postman collection uploaded'),
    execute: async () => {
      await collectEnvCredentials(context.config, {
        providerName: 'Postman',
        scope: 'account',
        fields: [{ key: 'POSTMAN_API_KEY', label: 'API key (PMAK-…)', secret: true }],
      });
      const result = await provision(context.config, context.secrets, context.state);
      context.applyStateUpdates(result.stateUpdates ?? {});
      if (!result.success) throw new Error(result.message);
      return result;
    },
  }),
  deleteInstructions: ({ state }) => {
    if (!(state.postman?.collectionId || state.postman?.workspaceId)) return [];
    const resources: Array<{ label: string; identifier: string }> = [];
    if (state.postman.workspaceId)
      resources.push({ label: 'Workspace ID', identifier: state.postman.workspaceId });
    if (state.postman.collectionId)
      resources.push({ label: 'Collection UID', identifier: state.postman.collectionId });
    return [
      {
        provider: 'Postman',
        dashboardUrl: 'https://go.postman.co/workspaces',
        steps: [
          'Open the workspace, then delete the collection (⋯ → Delete) and/or the workspace.',
          'Workspaces: ⋯ next to the workspace name → Delete workspace.',
        ],
        resources,
      },
    ];
  },
};
