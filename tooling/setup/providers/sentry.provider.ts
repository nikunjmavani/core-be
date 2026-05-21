import * as logger from '../logger.util.js';
import type { SetupConfig, SetupSecrets, SetupState, ProviderResult } from '../types.js';

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

export async function destroy(
  state: SetupState,
  secrets: SetupSecrets,
  organization: string,
): Promise<void> {
  if (!state.sentry?.projectSlug) return;

  const spinner = logger.startSpinner(`Deleting Sentry project: ${state.sentry.projectSlug}...`);
  try {
    await sentryRequest(
      secrets.sentry.authToken,
      'DELETE',
      `/projects/${organization}/${state.sentry.projectSlug}/`,
    );
    logger.stopSpinner(spinner, 'Sentry project deleted');
  } catch (deleteError) {
    const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
    logger.stopSpinner(spinner, `Failed to delete Sentry project: ${message}`, 'fail');
  }
}
