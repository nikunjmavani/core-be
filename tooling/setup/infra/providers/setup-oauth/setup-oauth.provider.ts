/**
 * OAuth (Google + GitHub) provider for `pnpm setup:infra`.
 *
 * Validates Google + GitHub OAuth credentials per environment (no resource is created —
 * credentials come from each provider console).
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import type { InfraProviderContext, ProviderResult } from '@tooling/setup/common/types.js';
import { readEnvFileValue } from '@tooling/setup/envs/read-env-file.js';
import { createValidationProvider } from '../create-validation-provider.js';

function validateClientId(
  label: string,
  clientId: string | undefined,
  environmentName: string,
  looksValid: (id: string) => boolean,
): boolean {
  if (!clientId) {
    logger.warn(`  ${label} OAuth for "${environmentName}" — not configured`);
    return true;
  }
  if (looksValid(clientId)) {
    logger.success(`  ${label} OAuth for "${environmentName}" — format valid`);
  } else {
    logger.warn(`  ${label} OAuth for "${environmentName}" — unusual client ID format`);
  }
  return true;
}

function validateOauth(context: InfraProviderContext): Promise<ProviderResult> {
  const { config, environments } = context;
  const googleEnabled = config.providers.oauth.google.enabled;
  const githubEnabled = config.providers.oauth.github.enabled;
  if (!(googleEnabled || githubEnabled)) {
    return Promise.resolve({ success: true, message: 'OAuth: skipped (disabled)' });
  }

  // OAuth client credentials are app secrets entered directly per environment in
  // `.env.<environment>` (OAUTH_<PROVIDER>_CLIENT_ID/SECRET/REDIRECT_URI) — not in setup
  // credentials. Validate the client-id format from each env file.
  logger.info('Validating OAuth credentials...');
  for (const environmentName of environments) {
    if (googleEnabled) {
      validateClientId(
        'Google',
        readEnvFileValue(environmentName, 'OAUTH_GOOGLE_CLIENT_ID'),
        environmentName,
        (id) => id.includes('.apps.googleusercontent.com'),
      );
    }
    if (githubEnabled) {
      validateClientId(
        'GitHub',
        readEnvFileValue(environmentName, 'OAUTH_GITHUB_CLIENT_ID'),
        environmentName,
        (id) => id.length >= 10,
      );
    }
  }
  return Promise.resolve({ success: true, message: 'OAuth: credentials validated' });
}

export const setupOauthProvider = createValidationProvider({
  key: 'oauth',
  name: 'OAuth (Google + GitHub)',
  isEnabled: ({ config }) =>
    config.providers.oauth.google.enabled || config.providers.oauth.github.enabled,
  disabledReason: () => 'OAuth providers disabled in setup.config.json',
  preview: {
    detail: 'Validates OAUTH_*_CLIENT_ID from each .env.<environment>',
    url: 'https://console.cloud.google.com/apis/credentials  +  https://github.com/settings/developers',
    configKey: '.env.<environment> → OAUTH_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI',
  },
  settingsDetail: 'validate Google + GitHub per env from .env.<environment>',
  instructions: [
    'Will validate OAuth client-id format from each .env.<environment>.',
    'No resource is created — enter the credentials directly in .env.<environment> (not setup credentials).',
  ],
  describe: ({ environments }) => ({ environments }),
  validate: validateOauth,
});
