import * as logger from '../../../common/logger.js';
import type {
  SetupSecrets,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

async function validateStripeKey(secretKey: string, environmentName: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (!response.ok) {
      logger.error(`  Stripe key for "${environmentName}" — invalid (${response.status})`);
      return false;
    }

    const isTestKey = secretKey.startsWith('sk_test_');
    const keyType = isTestKey ? 'test' : 'live';
    logger.success(`  Stripe key for "${environmentName}" — valid (${keyType} mode)`);
    return true;
  } catch {
    logger.error(`  Stripe key for "${environmentName}" — unreachable`);
    return false;
  }
}

export async function provision(
  secrets: SetupSecrets,
  environments: string[],
): Promise<ProviderResult> {
  if (!secrets.stripe || Object.keys(secrets.stripe).length === 0) {
    return { success: true, message: 'Stripe: skipped (no keys configured)' };
  }

  const spinner = logger.startSpinner('Validating Stripe API keys...');
  logger.stopSpinner(spinner, 'Validating Stripe API keys...');

  let allValid = true;

  for (const environmentName of environments) {
    const stripeEnvironmentSecrets = secrets.stripe[environmentName];
    if (!stripeEnvironmentSecrets?.secretKey) {
      logger.warn(`  Stripe key for "${environmentName}" — not configured`);
      continue;
    }

    const valid = await validateStripeKey(stripeEnvironmentSecrets.secretKey, environmentName);
    if (!valid) allValid = false;
  }

  return {
    success: allValid,
    message: allValid ? 'Stripe: all keys validated' : 'Stripe: some keys invalid',
  };
}

export const setupStripeProvider: InfraProvider = {
  key: 'stripe',
  name: 'Stripe',
  isEnabled: ({ config }) => config.providers.stripe.enabled,
  disabledReason: () => 'disabled in setup.config.json',
  preview: ({ config }) =>
    config.providers.stripe.enabled
      ? {
          detail: 'Secret key per env (development/production)',
          url: 'https://dashboard.stripe.com/test/apikeys',
          configKey: 'stripe.<env>.secretKey',
        }
      : null,
  settingsReview: ({ config, environments }) =>
    config.providers.stripe.enabled
      ? [{ bucket: 'extra', provider: 'Stripe', detail: `validate ${environments.length} keys` }]
      : [],
  buildStep: (context: InfraProviderContext) => ({
    name: 'Stripe',
    enabled: setupStripeProvider.isEnabled(context),
    enabledReason: setupStripeProvider.disabledReason(context),
    instructions: [
      `Will validate Stripe secret keys for ${context.environments.join(', ')} via Stripe API.`,
      'No resource is created — keys come from Stripe Dashboard.',
    ],
    execute: async () => {
      const result = await provision(context.secrets, context.environments);
      if (!result.success) throw new Error(result.message);
      return result;
    },
  }),
};
