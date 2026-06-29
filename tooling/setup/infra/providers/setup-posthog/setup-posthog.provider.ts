/**
 * PostHog provider for `pnpm setup:infra`.
 *
 * Resolves the public project API key (`phc_…`) from the personal API key via the PostHog
 * API and records it (+ ingest host) to state so build-env-vars wires POSTHOG_KEY/HOST.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; `.setup-state.json` is gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { isSecretFilled } from '@tooling/setup/common/secrets.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import { resourceStatus } from '@tooling/setup/common/interactive-step.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '@tooling/setup/common/types.js';

interface PosthogHosts {
  apiHost: string;
  ingestHost: string;
}

function resolveHosts(region: 'us' | 'eu'): PosthogHosts {
  return region === 'eu'
    ? { apiHost: 'https://eu.posthog.com', ingestHost: 'https://eu.i.posthog.com' }
    : { apiHost: 'https://us.posthog.com', ingestHost: 'https://us.i.posthog.com' };
}

/**
 * Resolve the public project API key (`phc_…`):
 *   1. verbatim `projectApiKey` override → used as-is (no API call)
 *   2. `projectId` set → GET /api/projects/<id>/ → api_token
 *   3. otherwise → GET /api/projects/ → results[0].api_token
 */
async function resolveProjectApiKey(
  secrets: SetupSecrets,
  apiHost: string,
): Promise<{ projectApiKey: string } | { error: string }> {
  const posthog = secrets.posthog;
  if (posthog?.projectApiKey) return { projectApiKey: posthog.projectApiKey };

  const personalApiKey = posthog?.personalApiKey ?? '';
  if (!personalApiKey) {
    return { error: 'POSTHOG_PERSONAL_API_KEY missing — cannot resolve the project key' };
  }

  const headers = { Authorization: `Bearer ${personalApiKey}` };

  try {
    if (posthog?.projectId) {
      const response = await setupFetch({
        name: 'PostHog',
        url: `${apiHost}/api/projects/${posthog.projectId}/`,
        init: { headers },
      });
      if (!response.ok) return { error: `PostHog API returned ${response.status}` };
      const body = (await response.json()) as { api_token?: string };
      if (!body.api_token) return { error: `Project ${posthog.projectId} returned no api_token` };
      return { projectApiKey: body.api_token };
    }

    const response = await setupFetch({
      name: 'PostHog',
      url: `${apiHost}/api/projects/`,
      init: { headers },
    });
    if (!response.ok) return { error: `PostHog API returned ${response.status}` };
    const body = (await response.json()) as { results?: Array<{ api_token?: string }> };
    const token = body.results?.[0]?.api_token;
    if (!token) return { error: 'No PostHog project found for this personal API key' };
    return { projectApiKey: token };
  } catch (resolutionError) {
    return {
      error: resolutionError instanceof Error ? resolutionError.message : String(resolutionError),
    };
  }
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
): Promise<ProviderResult> {
  if (!config.providers.posthog.enabled) {
    return { success: true, message: 'PostHog: skipped (disabled)' };
  }

  const { apiHost, ingestHost } = resolveHosts(config.providers.posthog.region);
  const spinner = logger.startSpinner('Resolving PostHog project key...');
  const resolved = await resolveProjectApiKey(secrets, apiHost);

  if ('error' in resolved) {
    logger.stopSpinner(spinner, `PostHog: ${resolved.error}`, 'fail');
    return { success: false, message: resolved.error };
  }

  logger.stopSpinner(spinner, `PostHog project key resolved (${ingestHost})`);
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

export const setupPosthogProvider: InfraProvider = {
  key: 'posthog',
  name: 'PostHog',
  isEnabled: ({ config, secrets }) =>
    config.providers.posthog.enabled &&
    (isSecretFilled(secrets.posthog?.personalApiKey) ||
      isSecretFilled(secrets.posthog?.projectApiKey)),
  disabledReason: ({ config }) =>
    !config.providers.posthog.enabled
      ? 'disabled in setup.config.json'
      : 'POSTHOG_PERSONAL_API_KEY (or POSTHOG_PROJECT_API_KEY) missing in .setup-credentials',
  preview: ({ config }) =>
    config.providers.posthog.enabled
      ? {
          detail: 'Resolve project key (phc_)',
          url: 'https://us.posthog.com/settings/user-api-keys',
          configKey: 'POSTHOG_PERSONAL_API_KEY → POSTHOG_KEY / POSTHOG_HOST',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.posthog.enabled
      ? [
          {
            bucket: 'extra',
            provider: 'PostHog',
            detail: `resolve project key (${config.providers.posthog.region})`,
          },
        ]
      : [],
  describe: ({ config }) => ({ project: config.project.name }),
  inspectRemote: async ({ config, secrets }) => {
    const posthog = config.providers.posthog;
    if (!posthog.enabled)
      return { present: false, fields: [], error: 'disabled in setup.config.json' };
    const personalApiKey = secrets.posthog?.personalApiKey ?? '';
    if (!personalApiKey) {
      return {
        present: false,
        fields: [],
        error: 'POSTHOG_PERSONAL_API_KEY missing in .setup-credentials',
      };
    }
    const { apiHost } = resolveHosts(posthog.region);
    try {
      const response = await setupFetch({
        name: 'PostHog',
        url: `${apiHost}/api/projects/`,
        init: { headers: { Authorization: `Bearer ${personalApiKey}` } },
      });
      if (!response.ok)
        return { present: false, fields: [], error: `PostHog API returned ${response.status}` };
      const body = (await response.json()) as { results?: Array<{ name?: string }> };
      const project = body.results?.[0];
      const expectedProject = config.project.name;
      return {
        present: Boolean(project),
        fields: [
          {
            label: 'project',
            expected: expectedProject,
            remote: project?.name ?? '—',
            matches: project?.name === expectedProject,
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
  buildStep: (context: InfraProviderContext) => ({
    name: 'PostHog',
    enabled: setupPosthogProvider.isEnabled(context),
    enabledReason: setupPosthogProvider.disabledReason(context),
    instructions: [
      'Resolves the PostHog project API key from the personal API key via the PostHog API.',
      'Saves the key + ingest host to state so build-env-vars wires POSTHOG_KEY / POSTHOG_HOST.',
    ],
    detectStatus: () =>
      resourceStatus(Boolean(context.state.posthog?.projectApiKey), 'PostHog project key in state'),
    execute: async () => {
      const result = await provision(context.config, context.secrets);
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
