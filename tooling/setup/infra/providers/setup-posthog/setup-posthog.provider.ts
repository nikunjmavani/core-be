/**
 * PostHog provider for `pnpm setup:infra`.
 *
 * Reads POSTHOG_PERSONAL_API_KEY from `.setup/.setup-credentials` (NOT a runtime .env file),
 * resolves the public project API key (`phc_…`) via the PostHog API, and writes
 * POSTHOG_KEY + POSTHOG_HOST into each `.env.<environment>`.
 *
 * NAMING (single source of truth = setup.config.json):
 *   • project name        = config.project.name          (reuse if it exists)
 *   • organization name   = config.project.organization  (created if the key has none)
 *   • environment names   = config.environments[].name
 * SECRETS: the personal key lives only in `.setup/.setup-credentials` (gitignored, never
 * printed). The resolved project key is public and written to `.env.<environment>`.
 * See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import { getEnvSetupValue } from '@tooling/setup/common/secrets.js';
import { resourceStatus } from '@tooling/setup/common/interactive-step.js';
import { readEnvFileValue } from '@tooling/setup/envs/read-env-file.js';
import type {
  SetupConfig,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '@tooling/setup/common/types.js';

interface PosthogSetupCredentials {
  personalApiKey: string;
  projectApiKey?: string;
  projectId?: string;
}

interface PosthogHosts {
  apiHost: string;
  ingestHost: string;
}

interface PosthogProject {
  id?: number;
  name?: string;
  api_token?: string;
}

function resolveHosts(region: 'us' | 'eu'): PosthogHosts {
  return region === 'eu'
    ? { apiHost: 'https://eu.posthog.com', ingestHost: 'https://eu.i.posthog.com' }
    : { apiHost: 'https://us.posthog.com', ingestHost: 'https://us.i.posthog.com' };
}

/** Read the PostHog setup inputs from `.setup/.setup-credentials`. */
function readPosthogCredentials(): PosthogSetupCredentials {
  const credentials: PosthogSetupCredentials = {
    personalApiKey: getEnvSetupValue('POSTHOG_PERSONAL_API_KEY'),
  };
  const projectApiKey = getEnvSetupValue('POSTHOG_PROJECT_API_KEY');
  const projectId = getEnvSetupValue('POSTHOG_PROJECT_ID');
  if (projectApiKey) credentials.projectApiKey = projectApiKey;
  if (projectId) credentials.projectId = projectId;
  return credentials;
}

/**
 * Resolve the public project API key (`phc_…`):
 *   1. verbatim `projectApiKey` override → used as-is (no API call)
 *   2. `projectId` override → GET /api/projects/<id>/ → api_token
 *   3. reuse the project named `config.project.name` if it already exists
 *   4. otherwise create an organization named `config.project.organization`
 *      (PostHog gives it one free project) and name that project after the repo
 */
async function resolveProjectApiKey(
  credentials: PosthogSetupCredentials,
  apiHost: string,
  config: SetupConfig,
): Promise<{ projectApiKey: string } | { error: string }> {
  if (credentials.projectApiKey) return { projectApiKey: credentials.projectApiKey };

  const { personalApiKey } = credentials;
  if (!personalApiKey) {
    return {
      error:
        'POSTHOG_PERSONAL_API_KEY missing in .setup/.setup-credentials — cannot resolve POSTHOG_KEY',
    };
  }

  const headers = { Authorization: `Bearer ${personalApiKey}`, 'Content-Type': 'application/json' };
  const projectName = config.project.name;
  const organizationName = config.project.organization;

  try {
    // 2) explicit project id
    if (credentials.projectId) {
      const response = await setupFetch({
        name: 'PostHog',
        url: `${apiHost}/api/projects/${credentials.projectId}/`,
        init: { headers },
      });
      if (!response.ok) return { error: `PostHog API returned ${response.status}` };
      const body = (await response.json()) as PosthogProject;
      if (!body.api_token)
        return { error: `Project ${credentials.projectId} returned no api_token` };
      return { projectApiKey: body.api_token };
    }

    // 3) reuse the project named after the repo
    const listResponse = await setupFetch({
      name: 'PostHog',
      url: `${apiHost}/api/projects/`,
      init: { headers },
    });
    if (!listResponse.ok) return { error: `PostHog API returned ${listResponse.status}` };
    const listBody = (await listResponse.json()) as { results?: PosthogProject[] };
    const named = (listBody.results ?? []).find((project) => project.name === projectName);
    if (named?.api_token) return { projectApiKey: named.api_token };

    // 4) create an organization (its one free project) named after the repo
    const orgResponse = await setupFetch({
      name: 'PostHog',
      url: `${apiHost}/api/organizations/`,
      init: { method: 'POST', headers, body: JSON.stringify({ name: organizationName }) },
    });
    if (!orgResponse.ok)
      return { error: `PostHog organization create returned ${orgResponse.status}` };
    const orgBody = (await orgResponse.json()) as { teams?: PosthogProject[] };
    const project = orgBody.teams?.[0];
    if (!project?.api_token) {
      return { error: 'PostHog organization created but no project api_token was returned' };
    }
    if (project.id) {
      // Best-effort: name the auto-created "Default project" after the repo so the
      // next run reuses it at step 3 and never re-creates.
      const renameResponse = await setupFetch({
        name: 'PostHog',
        url: `${apiHost}/api/projects/${project.id}/`,
        init: { method: 'PATCH', headers, body: JSON.stringify({ name: projectName }) },
      });
      if (!renameResponse.ok) {
        logger.warn(`PostHog: created project but could not rename it to "${projectName}".`);
      }
    }
    return { projectApiKey: project.api_token };
  } catch (resolutionError) {
    return {
      error: resolutionError instanceof Error ? resolutionError.message : String(resolutionError),
    };
  }
}

export async function provision(config: SetupConfig): Promise<ProviderResult> {
  if (!config.providers.posthog.enabled) {
    return { success: true, message: 'PostHog: skipped (disabled)' };
  }

  const credentials = readPosthogCredentials();
  const { apiHost, ingestHost } = resolveHosts(config.providers.posthog.region);
  const spinner = logger.startSpinner('Resolving PostHog project key...');
  const resolved = await resolveProjectApiKey(credentials, apiHost, config);

  if ('error' in resolved) {
    logger.stopSpinner(spinner, `PostHog: ${resolved.error}`, 'fail');
    return { success: false, message: resolved.error };
  }

  logger.stopSpinner(spinner, `PostHog project "${config.project.name}" resolved (${ingestHost})`);
  return {
    success: true,
    message: 'PostHog: project key resolved',
    stateUpdates: { posthog: { projectApiKey: resolved.projectApiKey, host: ingestHost } },
  };
}

async function check(config: SetupConfig, state: SetupState): Promise<boolean> {
  if (!config.providers.posthog.enabled) return true;
  return Boolean(state.posthog?.projectApiKey);
}

/** PostHog is configured once the personal (or project) key is in `.setup-credentials`. */
function posthogInputConfigured(): boolean {
  return Boolean(
    getEnvSetupValue('POSTHOG_PERSONAL_API_KEY') || getEnvSetupValue('POSTHOG_PROJECT_API_KEY'),
  );
}

export const setupPosthogProvider: InfraProvider = {
  key: 'posthog',
  name: 'PostHog',
  isEnabled: ({ config }) => config.providers.posthog.enabled && posthogInputConfigured(),
  disabledReason: ({ config }) =>
    !config.providers.posthog.enabled
      ? 'disabled in setup.config.json'
      : 'POSTHOG_PERSONAL_API_KEY (or POSTHOG_PROJECT_API_KEY) missing in .setup/.setup-credentials',
  preview: ({ config }) =>
    config.providers.posthog.enabled
      ? {
          detail: `Resolve POSTHOG_KEY for project "${config.project.name}"`,
          url: 'https://us.posthog.com/settings/user-api-keys',
          configKey:
            '.setup/.setup-credentials → POSTHOG_PERSONAL_API_KEY → POSTHOG_KEY / POSTHOG_HOST',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.posthog.enabled
      ? [
          {
            bucket: 'extra',
            provider: 'PostHog',
            detail: `resolve POSTHOG_KEY for "${config.project.name}" (${config.providers.posthog.region})`,
          },
        ]
      : [],
  describe: ({ config }) => ({
    project: config.project.name,
    organization: config.project.organization,
  }),
  inspectRemote: async ({ config }) => {
    const posthog = config.providers.posthog;
    if (!posthog.enabled) {
      return { present: false, fields: [], error: 'disabled in setup.config.json' };
    }
    const credentials = readPosthogCredentials();
    if (!credentials.personalApiKey) {
      return {
        present: false,
        fields: [],
        error: 'POSTHOG_PERSONAL_API_KEY missing in .setup/.setup-credentials',
      };
    }
    const { apiHost } = resolveHosts(posthog.region);
    try {
      const response = await setupFetch({
        name: 'PostHog',
        url: `${apiHost}/api/projects/`,
        init: { headers: { Authorization: `Bearer ${credentials.personalApiKey}` } },
      });
      if (!response.ok) {
        return { present: false, fields: [], error: `PostHog API returned ${response.status}` };
      }
      const body = (await response.json()) as { results?: PosthogProject[] };
      const expectedProject = config.project.name;
      const match = (body.results ?? []).find((project) => project.name === expectedProject);
      return {
        present: Boolean(match),
        fields: [
          {
            label: 'project',
            expected: expectedProject,
            remote: match?.name ?? body.results?.[0]?.name ?? '—',
            matches: Boolean(match),
          },
          { label: 'region', expected: posthog.region, remote: posthog.region, matches: true },
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
  toEnvironmentVariables: ({ config, state }, environmentName) => {
    if (!config.providers.posthog.enabled) return {};
    const override = readEnvFileValue(environmentName, 'POSTHOG_PROJECT_API_KEY');
    const key = override ?? state.posthog?.projectApiKey;
    if (!key) return {};
    return {
      POSTHOG_KEY: key,
      ...(state.posthog?.host ? { POSTHOG_HOST: state.posthog.host } : {}),
    };
  },
  buildStep: (context: InfraProviderContext) => ({
    name: 'PostHog',
    enabled: setupPosthogProvider.isEnabled(context),
    enabledReason: setupPosthogProvider.disabledReason(context),
    instructions: [
      'Get a Personal API key (phx_…): https://us.posthog.com/settings/user-api-keys → "Create personal API key" → "All access".',
      'Put it in .setup/.setup-credentials as POSTHOG_PERSONAL_API_KEY=… (setup input — never used at API runtime).',
      `Setup reuses the project "${context.config.project.name}" (or creates org "${context.config.project.organization}" with it), then writes POSTHOG_KEY + POSTHOG_HOST to each .env.<environment>.`,
      'Optional: POSTHOG_PROJECT_API_KEY=phc_… skips the API lookup; POSTHOG_PROJECT_ID pins a project.',
    ],
    detectStatus: () =>
      resourceStatus(Boolean(context.state.posthog?.projectApiKey), 'PostHog project key in state'),
    execute: async () => {
      const result = await provision(context.config);
      if (!result.success) throw new Error(result.message);
      context.applyStateUpdates(result.stateUpdates ?? {});
      return result;
    },
    verifyState: () => ({
      ok: Boolean(context.state.posthog?.projectApiKey),
      message: context.state.posthog?.host
        ? `key resolved (${context.state.posthog.host})`
        : 'no PostHog key recorded',
    }),
  }),
  check: ({ config, state }) => check(config, state),
};

export function posthogGuideConfigured(): boolean {
  return posthogInputConfigured();
}
