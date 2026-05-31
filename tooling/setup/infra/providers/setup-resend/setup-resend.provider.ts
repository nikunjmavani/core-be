import * as logger from '@tooling/setup/common/logger.js';
import { isSecretFilled } from '@tooling/setup/common/secrets.js';
import type {
  SetupSecrets,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '@tooling/setup/common/types.js';

export async function provision(secrets: SetupSecrets): Promise<ProviderResult> {
  const apiKey = secrets.resend.apiKey;

  if (!apiKey) {
    return { success: true, message: 'Resend: skipped (no API key)' };
  }

  const spinner = logger.startSpinner('Validating Resend API key...');

  try {
    const response = await fetch('https://api.resend.com/api-keys', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Resend API returned ${response.status}`);
    }

    logger.stopSpinner(spinner, 'Resend API key — valid');
    return { success: true, message: 'Resend: API key validated' };
  } catch (validationError) {
    const message =
      validationError instanceof Error ? validationError.message : String(validationError);
    logger.stopSpinner(spinner, `Resend validation failed: ${message}`, 'fail');
    return { success: false, message };
  }
}

export const setupResendProvider: InfraProvider = {
  key: 'resend',
  name: 'Resend',
  isEnabled: ({ config, secrets }) =>
    config.providers.resend.enabled && isSecretFilled(secrets.resend.apiKey),
  disabledReason: ({ config }) =>
    !config.providers.resend.enabled
      ? 'disabled in setup.config.json'
      : 'RESEND_API_KEY missing in .env.setup',
  preview: ({ config }) =>
    config.providers.resend.enabled
      ? {
          detail: 'API key',
          url: 'https://resend.com/api-keys',
          configKey: 'resend.apiKey',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.resend.enabled
      ? [{ bucket: 'extra', provider: 'Resend', detail: 'validate 1 key' }]
      : [],
  buildStep: (context: InfraProviderContext) => ({
    name: 'Resend',
    enabled: setupResendProvider.isEnabled(context),
    enabledReason: setupResendProvider.disabledReason(context),
    instructions: [
      'Will validate RESEND_API_KEY by calling https://api.resend.com/domains.',
      'No resource is created — Resend exposes a single org-level key.',
    ],
    execute: async () => {
      const result = await provision(context.secrets);
      if (!result.success) throw new Error(result.message);
      return result;
    },
  }),
};
