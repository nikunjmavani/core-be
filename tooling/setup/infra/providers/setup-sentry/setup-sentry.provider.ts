import * as logger from '../../../common/logger.js';
import { isSecretFilled } from '../../../common/secrets.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

const SENTRY_API_BASE = 'https://sentry.io/api/0';

function sentryHeaders(authToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function sentryRequest<T>(
  authToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${SENTRY_API_BASE}${path}`, {
    method,
    headers: sentryHeaders(authToken),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Sentry API ${method} ${path} failed (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

interface SentryProject {
  id: string;
  slug: string;
  name: string;
}

interface SentryKey {
  dsn: {
    public: string;
  };
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
): Promise<ProviderResult> {
  const authToken = secrets.sentry.authToken;
  const sentryConfig = config.providers.sentry;
  const projectName = config.project.name;

  const spinner = logger.startSpinner('Setting up Sentry project...');

  try {
    let projectSlug = state.sentry?.projectSlug;
    let dsn = state.sentry?.dsn;

    if (!projectSlug) {
      // Check if project already exists
      try {
        const existingProject = await sentryRequest<SentryProject>(
          authToken,
          'GET',
          `/projects/${sentryConfig.organization}/${projectName}/`,
        );
        projectSlug = existingProject.slug;
        logger.stopSpinner(spinner, `Sentry project already exists: ${projectSlug}`);
      } catch {
        // Create new project
        const newProject = await sentryRequest<SentryProject>(
          authToken,
          'POST',
          `/teams/${sentryConfig.organization}/${sentryConfig.project ?? sentryConfig.team}/projects/`,
          {
            name: projectName,
            slug: projectName,
            platform: sentryConfig.platform,
          },
        );
        projectSlug = newProject.slug;
        logger.stopSpinner(spinner, `Sentry project created: ${projectSlug}`);
      }
    } else {
      logger.stopSpinner(spinner, `Sentry project already in state: ${projectSlug}`);
    }

    // Get DSN
    if (!dsn) {
      const keys = await sentryRequest<SentryKey[]>(
        authToken,
        'GET',
        `/projects/${sentryConfig.organization}/${projectSlug}/keys/`,
      );

      if (keys.length === 0) {
        throw new Error('No client keys found for Sentry project');
      }

      dsn = keys[0]!.dsn.public;
      logger.success(`Sentry DSN retrieved`);
    }

    return {
      success: true,
      message: `Sentry: project "${projectSlug}" ready`,
      stateUpdates: { sentry: { projectSlug: projectSlug!, dsn: dsn! } },
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.stopSpinner(spinner, `Sentry provisioning failed: ${message}`, 'fail');
    return { success: false, message };
  }
}

export async function check(
  state: SetupState,
  secrets: SetupSecrets,
  organization: string,
): Promise<boolean> {
  if (!state.sentry?.projectSlug) {
    logger.error('Sentry: no project in state');
    return false;
  }

  try {
    await sentryRequest(
      secrets.sentry.authToken,
      'GET',
      `/projects/${organization}/${state.sentry.projectSlug}/`,
    );
    logger.success(`Sentry project "${state.sentry.projectSlug}" — reachable`);
    return true;
  } catch {
    logger.error(`Sentry project "${state.sentry.projectSlug}" — unreachable`);
    return false;
  }
}

export const setupSentryProvider: InfraProvider = {
  key: 'sentry',
  name: 'Sentry',
  isEnabled: ({ config, secrets }) =>
    config.providers.sentry.enabled && isSecretFilled(secrets.sentry.authToken),
  disabledReason: ({ config }) =>
    !config.providers.sentry.enabled
      ? 'disabled in setup.config.json'
      : 'SENTRY_AUTH_TOKEN missing in .env.setup',
  preview: ({ config }) =>
    config.providers.sentry.enabled
      ? {
          detail: 'Auth token',
          url: 'https://sentry.io/settings/auth-tokens/new-token/',
          configKey: 'sentry.authToken',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.sentry.enabled
      ? [
          {
            bucket: 'resource',
            provider: 'Sentry',
            detail: `1 project (${config.providers.sentry.organization}/${
              config.providers.sentry.project ?? config.providers.sentry.team
            })`,
          },
        ]
      : [],
  detectExisting: async ({ config, secrets }) => {
    if (!config.providers.sentry.enabled || !isSecretFilled(secrets.sentry.authToken)) return [];
    try {
      const response = await fetch(
        `https://sentry.io/api/0/projects/${config.providers.sentry.organization}/${config.project.name}/`,
        {
          headers: {
            Authorization: `Bearer ${secrets.sentry.authToken}`,
            Accept: 'application/json',
          },
        },
      );
      if (response.ok) {
        return [
          {
            provider: 'Sentry',
            detail: `project "${config.project.name}" already exists`,
          },
        ];
      }
    } catch {
      logger.warn('  Could not check Sentry for existing resources');
    }
    return [];
  },
  buildStep: (context: InfraProviderContext) => ({
    name: 'Sentry',
    enabled: setupSentryProvider.isEnabled(context),
    enabledReason: setupSentryProvider.disabledReason(context),
    instructions: [
      `Will create or adopt one Sentry project: ${context.config.providers.sentry.organization}/${
        context.config.providers.sentry.project ?? context.config.providers.sentry.team
      }.`,
      'Saves the DSN to state so build-env-vars can wire SENTRY_DSN per environment.',
    ],
    alreadyDone: () => Boolean(context.state.sentry?.dsn),
    alreadyDoneMessage: 'Sentry DSN already in state',
    execute: async () => {
      const result = await provision(context.config, context.secrets, context.state);
      if (!result.success) throw new Error(result.message);
      context.applyStateUpdates(result.stateUpdates ?? {});
      return result;
    },
    verifyState: () => ({
      ok: Boolean(context.state.sentry?.dsn),
      message: context.state.sentry?.projectSlug
        ? `project "${context.state.sentry.projectSlug}" with DSN`
        : 'no Sentry DSN recorded',
    }),
    verifyLive: async () => {
      const ok = await check(
        context.state,
        context.secrets,
        context.config.providers.sentry.organization,
      );
      return { ok, message: ok ? 'reachable' : 'unreachable' };
    },
  }),
  check: ({ config, state, secrets }) =>
    check(state, secrets, config.providers.sentry.organization),
  deleteInstructions: ({ config, state }) => {
    if (!state.sentry?.projectSlug) return [];
    const organization = config.providers.sentry.organization;
    return [
      {
        provider: 'Sentry',
        dashboardUrl: `https://sentry.io/settings/${organization}/projects/${state.sentry.projectSlug}/`,
        steps: [
          'Open the project page above.',
          'Settings → Remove Project (or, for the team, Settings → Teams → Remove team).',
        ],
        resources: [
          { label: 'Project slug', identifier: state.sentry.projectSlug },
          ...(state.sentry.dsn
            ? [{ label: 'DSN (will be invalidated)', identifier: state.sentry.dsn }]
            : []),
        ],
      },
    ];
  },
};
