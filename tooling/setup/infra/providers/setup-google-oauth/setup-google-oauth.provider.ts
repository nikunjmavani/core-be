/**
 * Google OAuth provider for `pnpm setup:infra`.
 *
 * Step-by-step guide + client-id format validation per environment. No OAuth client is
 * created via API — credentials are entered in each `.env.<environment>`.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import type {
  InfraProvider,
  InfraProviderContext,
  ProviderResult,
  SetupConfig,
} from '@tooling/setup/common/types.js';
import {
  collectEnvCredentials,
  everyEnvironmentHasEnvKeys,
  frontendUrlForEnvironment,
  oauthAppDisplayName,
} from '@tooling/setup/envs/env-file-setup.util.js';
import { readEnvFileValue } from '@tooling/setup/envs/read-env-file.js';

/**
 * Backend OAuth callback path. The redirect URI is the BACKEND origin + this path —
 * the backend brokers the authorization-code↔token exchange (the client secret never
 * touches the browser), so it is NOT the frontend origin. It must include the `/api/v1`
 * API prefix to match the registered route (`/api/v1/auth/oauth/:provider/callback`).
 */
const GOOGLE_CALLBACK_PATH = '/api/v1/auth/oauth/google/callback';

function buildGoogleOauthGuideInstructions(config: SetupConfig): string[] {
  const projectName = config.project.name;
  const lines: string[] = [
    'No resource is created — create one Web-application OAuth client per environment in Google Cloud Console, then paste the values into each `.env.<environment>`.',
    '',
  ];

  for (const environment of config.environments) {
    const environmentName = environment.name;
    const appName = oauthAppDisplayName(projectName, environmentName);
    // frontendUrlForEnvironment yields the backend origin used for the callback
    // (dev → http://localhost:3000). The redirect URI is that origin + /api/v1 path.
    const backendUrl = frontendUrlForEnvironment(config, environmentName);
    const callbackUrl = backendUrl
      ? `${backendUrl}${GOOGLE_CALLBACK_PATH}`
      : `https://<your-backend>${GOOGLE_CALLBACK_PATH}`;

    lines.push(`--- ${environmentName} → .env.${environmentName} ---`);
    lines.push('1. Pick or create a project: https://console.cloud.google.com/projectcreate');
    lines.push(
      '2. OAuth consent screen → External, then add your Google account under Test users — ' +
        'required while the app is in Testing, else sign-in fails with access_denied: ' +
        'https://console.cloud.google.com/auth/overview',
    );
    lines.push(
      '3. Credentials → Create Credentials → OAuth client ID → Application type: ' +
        'Web application (Desktop type will NOT work): https://console.cloud.google.com/apis/credentials',
    );
    lines.push(`4. Name: "${appName}"`);
    if (!backendUrl) {
      lines.push(
        `5. Set app.frontendUrl.${environmentName} (the backend origin) in setup.config.json, then add this Authorized redirect URI (exact match — backend origin + /api/v1): ${callbackUrl}`,
      );
    } else {
      lines.push(
        `5. Authorized redirect URI — paste EXACTLY (backend origin + /api/v1, NOT the frontend): ${callbackUrl}`,
      );
    }
    lines.push(
      '6. Create, then copy the Client ID (ends .apps.googleusercontent.com) and Client Secret (starts GOCSPX-)',
    );
    lines.push(`7. In .env.${environmentName} set:`);
    lines.push('   OAUTH_GOOGLE_CLIENT_ID=….apps.googleusercontent.com');
    lines.push('   OAUTH_GOOGLE_CLIENT_SECRET=…');
    lines.push(`   OAUTH_GOOGLE_REDIRECT_URI=${callbackUrl}`);
    lines.push('');
  }

  return lines;
}

async function validateGoogleOauth(context: InfraProviderContext): Promise<ProviderResult> {
  if (!context.config.providers.oauth.google.enabled) {
    return { success: true, message: 'Google OAuth: skipped (disabled)' };
  }

  logger.info('Validating Google OAuth credentials from .env.<environment>...');
  for (const environmentName of context.environments) {
    const clientId = readEnvFileValue(environmentName, 'OAUTH_GOOGLE_CLIENT_ID');
    if (!clientId) {
      logger.warn(
        `  Google OAuth for "${environmentName}" — not configured in .env.${environmentName}`,
      );
    } else if (clientId.includes('.apps.googleusercontent.com')) {
      logger.success(`  Google OAuth for "${environmentName}" — format valid`);
    } else {
      logger.warn(`  Google OAuth for "${environmentName}" — unusual client ID format`);
    }
  }
  return { success: true, message: 'Google OAuth: credentials validated' };
}

export function googleOauthGuideConfigured(config: SetupConfig): boolean {
  return everyEnvironmentHasEnvKeys(config, ['OAUTH_GOOGLE_CLIENT_ID']);
}

export const setupGoogleOauthProvider: InfraProvider = {
  key: 'google-oauth',
  name: 'Google OAuth',
  isEnabled: ({ config }) => config.providers.oauth.google.enabled,
  disabledReason: () => 'Google OAuth disabled in setup.config.json',
  preview: ({ config }) =>
    config.providers.oauth.google.enabled
      ? {
          detail: 'Step-by-step OAuth client setup per .env.<environment>',
          url: 'https://console.cloud.google.com/apis/credentials',
          configKey: '.env.<environment> → OAUTH_GOOGLE_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.oauth.google.enabled
      ? [{ bucket: 'extra', provider: 'Google OAuth', detail: 'guide + validate per env file' }]
      : [],
  describe: ({ environments }) => ({ environments }),
  inspectRemote: async ({ config }) => ({
    present: false,
    fields: [],
    error: config.providers.oauth.google.enabled
      ? 'validate-only — enter credentials in .env.<environment>'
      : 'Google OAuth disabled in setup.config.json',
  }),
  buildStep: (context: InfraProviderContext) => ({
    name: 'Google OAuth',
    enabled: setupGoogleOauthProvider.isEnabled(context),
    enabledReason: setupGoogleOauthProvider.disabledReason(context),
    instructions: buildGoogleOauthGuideInstructions(context.config),
    execute: async () => {
      await collectEnvCredentials(context.config, {
        providerName: 'Google OAuth',
        scope: 'per-environment',
        fields: [
          { key: 'OAUTH_GOOGLE_CLIENT_ID', label: 'Client ID (….apps.googleusercontent.com)' },
          { key: 'OAUTH_GOOGLE_CLIENT_SECRET', label: 'Client Secret (GOCSPX-…)', secret: true },
          {
            key: 'OAUTH_GOOGLE_REDIRECT_URI',
            label: 'Redirect URI',
            defaultValue: (config, environmentName) => {
              const backendUrl = frontendUrlForEnvironment(config, environmentName);
              return backendUrl ? `${backendUrl}${GOOGLE_CALLBACK_PATH}` : '';
            },
          },
        ],
      });
      const result = await validateGoogleOauth(context);
      if (!result.success) throw new Error(result.message);
      return result;
    },
  }),
};
