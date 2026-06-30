/**
 * GitHub OAuth provider for `pnpm setup:infra`.
 *
 * Step-by-step guide + client-id format validation per environment. No OAuth app is created
 * via API — credentials are entered in each `.env.<environment>`.
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

function buildGithubOauthGuideInstructions(config: SetupConfig): string[] {
  const projectName = config.project.name;
  const lines: string[] = [
    'No resource is created — create one GitHub OAuth App per environment, then paste into each `.env.<environment>`.',
    '',
  ];

  for (const environment of config.environments) {
    const environmentName = environment.name;
    const appName = oauthAppDisplayName(projectName, environmentName);
    const frontendUrl = frontendUrlForEnvironment(config, environmentName);
    // The callback hits the BACKEND OAuth handler, which is mounted under /api/v1
    // (GET /api/v1/auth/oauth/:provider/callback). It MUST include the /api/v1 prefix
    // and match the GitHub OAuth App's registered Authorization callback URL exactly.
    const callbackUrl = frontendUrl
      ? `${frontendUrl}/api/v1/auth/oauth/github/callback`
      : 'https://<your-backend>/api/v1/auth/oauth/github/callback';

    lines.push(`--- ${environmentName} → .env.${environmentName} ---`);
    lines.push('1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App');
    lines.push(`2. Application name: "${appName}"`);
    if (!frontendUrl) {
      lines.push(
        `3. Set app.frontendUrl.${environmentName} in setup.config.json, then set Homepage URL and Callback URL: ${callbackUrl}`,
      );
    } else {
      lines.push(`3. Homepage URL: ${frontendUrl}`);
      lines.push(`4. Authorization callback URL: ${callbackUrl}`);
    }
    lines.push('5. Generate a new client secret');
    lines.push(`6. In .env.${environmentName} set:`);
    lines.push('   OAUTH_GITHUB_CLIENT_ID=…');
    lines.push('   OAUTH_GITHUB_CLIENT_SECRET=…');
    lines.push(`   OAUTH_GITHUB_REDIRECT_URI=${callbackUrl}`);
    lines.push('');
  }

  return lines;
}

type GithubOauthProbe = 'valid' | 'invalid' | 'unverified' | 'unreachable';

/**
 * Live-validate a GitHub OAuth App's Client ID + Secret by authenticating the *app itself*
 * against `POST /applications/{client_id}/token` with HTTP Basic auth (client_id:secret).
 *
 * @remarks
 * **Algorithm:** a deliberately invalid probe token is sent — GitHub authenticates the app
 * via Basic auth before looking at the token, so the status reveals the credentials:
 * `401`/`403` ⇒ the Client ID/Secret are wrong (`invalid`); `422` ⇒ the app authenticated
 * and only the probe token is bad, so the credentials are good (`valid`); `404` ⇒ set but
 * unconfirmable (`unverified`). **Failure modes:** any network error ⇒ `unreachable`.
 * **Side effects:** one outbound HTTPS request to api.github.com; never throws.
 */
async function probeGithubOauthCredentials(
  clientId: string,
  clientSecret: string,
): Promise<GithubOauthProbe> {
  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'setup-github-oauth-probe' }),
    });
    if (response.status === 401 || response.status === 403) return 'invalid';
    if (response.status === 422) return 'valid';
    return 'unverified';
  } catch {
    return 'unreachable';
  }
}

async function validateGithubOauth(context: InfraProviderContext): Promise<ProviderResult> {
  if (!context.config.providers.oauth.github.enabled) {
    return { success: true, message: 'GitHub OAuth: skipped (disabled)' };
  }

  logger.info('Validating GitHub OAuth credentials from .env.<environment>...');
  let allValid = true;
  for (const environmentName of context.environments) {
    const clientId = readEnvFileValue(environmentName, 'OAUTH_GITHUB_CLIENT_ID');
    const clientSecret = readEnvFileValue(environmentName, 'OAUTH_GITHUB_CLIENT_SECRET');

    // Missing creds are a warning (you may fill them later), not a hard failure.
    if (!(clientId && clientSecret)) {
      logger.warn(
        `  GitHub OAuth for "${environmentName}" — not fully configured in .env.${environmentName} (need OAUTH_GITHUB_CLIENT_ID + _CLIENT_SECRET)`,
      );
      continue;
    }

    const probe = await probeGithubOauthCredentials(clientId, clientSecret);
    if (probe === 'valid') {
      logger.success(
        `  GitHub OAuth for "${environmentName}" — credentials verified against GitHub`,
      );
    } else if (probe === 'invalid') {
      logger.error(
        `  GitHub OAuth for "${environmentName}" — GitHub rejected these credentials (HTTP 401). Check OAUTH_GITHUB_CLIENT_ID / _CLIENT_SECRET.`,
      );
      allValid = false;
    } else if (probe === 'unreachable') {
      logger.warn(
        `  GitHub OAuth for "${environmentName}" — could not reach GitHub to validate (offline?).`,
      );
    } else {
      logger.warn(
        `  GitHub OAuth for "${environmentName}" — credentials set, but GitHub could not confirm them remotely.`,
      );
    }
  }
  return allValid
    ? { success: true, message: 'GitHub OAuth: credentials validated' }
    : {
        success: false,
        message: 'GitHub OAuth: one or more environments have invalid credentials',
      };
}

export function githubOauthGuideConfigured(config: SetupConfig): boolean {
  return everyEnvironmentHasEnvKeys(config, ['OAUTH_GITHUB_CLIENT_ID']);
}

export const setupGithubOauthProvider: InfraProvider = {
  key: 'github-oauth',
  name: 'GitHub OAuth',
  isEnabled: ({ config }) => config.providers.oauth.github.enabled,
  disabledReason: () => 'GitHub OAuth disabled in setup.config.json',
  preview: ({ config }) =>
    config.providers.oauth.github.enabled
      ? {
          detail: 'Step-by-step OAuth app setup per .env.<environment>',
          url: 'https://github.com/settings/developers',
          configKey: '.env.<environment> → OAUTH_GITHUB_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.oauth.github.enabled
      ? [{ bucket: 'extra', provider: 'GitHub OAuth', detail: 'guide + validate per env file' }]
      : [],
  describe: ({ environments }) => ({ environments }),
  inspectRemote: async ({ config }) => ({
    present: false,
    fields: [],
    error: config.providers.oauth.github.enabled
      ? 'validate-only — enter credentials in .env.<environment>'
      : 'GitHub OAuth disabled in setup.config.json',
  }),
  buildStep: (context: InfraProviderContext) => ({
    name: 'GitHub OAuth',
    enabled: setupGithubOauthProvider.isEnabled(context),
    enabledReason: setupGithubOauthProvider.disabledReason(context),
    instructions: buildGithubOauthGuideInstructions(context.config),
    execute: async () => {
      await collectEnvCredentials(context.config, {
        providerName: 'GitHub OAuth',
        scope: 'per-environment',
        fields: [
          { key: 'OAUTH_GITHUB_CLIENT_ID', label: 'Client ID' },
          { key: 'OAUTH_GITHUB_CLIENT_SECRET', label: 'Client Secret', secret: true },
          {
            key: 'OAUTH_GITHUB_REDIRECT_URI',
            label: 'Redirect URI',
            defaultValue: (config, environmentName) => {
              const backendUrl = frontendUrlForEnvironment(config, environmentName);
              return backendUrl ? `${backendUrl}/api/v1/auth/oauth/github/callback` : '';
            },
          },
        ],
      });
      const result = await validateGithubOauth(context);
      if (!result.success) throw new Error(result.message);
      return result;
    },
  }),
};
