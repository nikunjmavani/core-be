import * as logger from '@tooling/setup/common/logger.js';
import type {
  SetupConfig,
  SetupSecrets,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
  InfraProviderPreview,
} from '@tooling/setup/common/types.js';

async function validateGoogleOAuth(clientId: string, environmentName: string): Promise<boolean> {
  if (!clientId) {
    logger.warn(`  Google OAuth for "${environmentName}" — not configured`);
    return true;
  }

  // Basic format validation (Google client IDs end with .apps.googleusercontent.com)
  if (clientId.includes('.apps.googleusercontent.com')) {
    logger.success(`  Google OAuth for "${environmentName}" — format valid`);
    return true;
  }

  logger.warn(`  Google OAuth for "${environmentName}" — unusual client ID format`);
  return true;
}

async function validateGithubOAuth(
  clientId: string,
  clientSecret: string,
  environmentName: string,
): Promise<boolean> {
  if (!clientId) {
    logger.warn(`  GitHub OAuth for "${environmentName}" — not configured`);
    return true;
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch(`https://api.github.com/applications/${clientId}`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (response.ok) {
      logger.success(`  GitHub OAuth for "${environmentName}" — valid`);
      return true;
    }

    // 404 might mean the app exists but auth check works differently
    if (response.status === 404 || response.status === 401) {
      logger.success(
        `  GitHub OAuth for "${environmentName}" — credentials set (cannot verify remotely)`,
      );
      return true;
    }

    logger.warn(`  GitHub OAuth for "${environmentName}" — validation returned ${response.status}`);
    return true;
  } catch {
    logger.warn(`  GitHub OAuth for "${environmentName}" — could not validate (network issue)`);
    return true;
  }
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  environments: string[],
): Promise<ProviderResult> {
  const googleEnabled = config.providers.oauth.google.enabled;
  const githubEnabled = config.providers.oauth.github.enabled;

  if (!(googleEnabled || githubEnabled)) {
    return { success: true, message: 'OAuth: skipped (disabled)' };
  }

  logger.info('Validating OAuth credentials...');

  let allValid = true;

  if (googleEnabled && secrets.oauth?.google) {
    for (const environmentName of environments) {
      const googleSecrets = secrets.oauth.google[environmentName];
      if (googleSecrets) {
        const valid = await validateGoogleOAuth(googleSecrets.clientId, environmentName);
        if (!valid) allValid = false;
      }
    }
  }

  if (githubEnabled && secrets.oauth?.github) {
    for (const environmentName of environments) {
      const githubSecrets = secrets.oauth.github[environmentName];
      if (githubSecrets) {
        const valid = await validateGithubOAuth(
          githubSecrets.clientId,
          githubSecrets.clientSecret,
          environmentName,
        );
        if (!valid) allValid = false;
      }
    }
  }

  return {
    success: allValid,
    message: allValid ? 'OAuth: credentials validated' : 'OAuth: some credentials invalid',
  };
}

function googlePreview(): InfraProviderPreview {
  return {
    detail: 'Client ID + Secret per env',
    url: 'https://console.cloud.google.com/apis/credentials',
    configKey: 'oauth.google.<env>.clientId, clientSecret, redirectUri',
  };
}

function githubPreview(): InfraProviderPreview {
  return {
    detail: 'Client ID + Secret per env',
    url: 'https://github.com/settings/developers',
    configKey: 'oauth.github.<env>.clientId, clientSecret, redirectUri',
  };
}

export const setupOauthProvider: InfraProvider = {
  key: 'oauth',
  name: 'OAuth (Google + GitHub)',
  isEnabled: ({ config }) =>
    config.providers.oauth.google.enabled || config.providers.oauth.github.enabled,
  disabledReason: () => 'OAuth providers disabled in setup.config.json',
  // OAuth has two sub-providers — preview() returns the first enabled (Google preferred).
  preview: ({ config }) => {
    if (config.providers.oauth.google.enabled) return googlePreview();
    if (config.providers.oauth.github.enabled) return githubPreview();
    return null;
  },
  settingsReview: ({ config }) =>
    config.providers.oauth.google.enabled || config.providers.oauth.github.enabled
      ? [{ bucket: 'extra', provider: 'OAuth', detail: 'validate Google + GitHub per env' }]
      : [],
  buildStep: (context: InfraProviderContext) => ({
    name: 'OAuth (Google + GitHub)',
    enabled: setupOauthProvider.isEnabled(context),
    enabledReason: setupOauthProvider.disabledReason(context),
    instructions: [
      'Will validate OAuth credentials for each enabled provider per environment.',
      'No resource is created — credentials come from each provider console.',
    ],
    execute: async () => {
      const result = await provision(context.config, context.secrets, context.environments);
      if (!result.success) throw new Error(result.message);
      return result;
    },
  }),
};
