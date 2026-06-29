/**
 * Stripe provider for `pnpm setup:infra`.
 *
 * Validates Stripe API keys per environment (test vs live mode); no resource is created.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import type { InfraProviderContext, ProviderResult } from '@tooling/setup/common/types.js';
import { readEnvFileValue } from '@tooling/setup/envs/read-env-file.js';
import { createValidationProvider } from '../create-validation-provider.js';

async function validateStripeKey(secretKey: string, environmentName: string): Promise<boolean> {
  try {
    await setupFetch({
      name: 'Stripe',
      url: 'https://api.stripe.com/v1/balance',
      init: { headers: { Authorization: `Bearer ${secretKey}` } },
      expectedStatus: 200,
    });
    const keyType = secretKey.startsWith('sk_test_') ? 'test' : 'live';
    logger.success(`  Stripe key for "${environmentName}" — valid (${keyType} mode)`);
    return true;
  } catch {
    logger.error(`  Stripe key for "${environmentName}" — invalid or unreachable`);
    return false;
  }
}

async function validateStripe(context: InfraProviderContext): Promise<ProviderResult> {
  // Stripe is an app secret entered directly per environment in `.env.<environment>`
  // (STRIPE_SECRET_KEY) — not in `.setup/.setup-credentials`. Validate whatever is there.
  let allValid = true;
  let anyConfigured = false;
  for (const environmentName of context.environments) {
    const secretKey = readEnvFileValue(environmentName, 'STRIPE_SECRET_KEY');
    if (!secretKey) {
      logger.warn(`  Stripe key for "${environmentName}" — not set in .env.${environmentName}`);
      continue;
    }
    anyConfigured = true;
    if (!(await validateStripeKey(secretKey, environmentName))) allValid = false;
  }

  if (!anyConfigured) {
    return { success: true, message: 'Stripe: skipped (no STRIPE_SECRET_KEY in any .env.<env>)' };
  }
  return {
    success: allValid,
    message: allValid ? 'Stripe: all keys validated' : 'Stripe: some keys invalid',
  };
}

export const setupStripeProvider = createValidationProvider({
  key: 'stripe',
  name: 'Stripe',
  isEnabled: ({ config }) => config.providers.stripe.enabled,
  disabledReason: () => 'disabled in setup.config.json',
  preview: {
    detail: 'Validates STRIPE_SECRET_KEY from each .env.<environment>',
    url: 'https://dashboard.stripe.com/test/apikeys',
    configKey: '.env.<environment> → STRIPE_SECRET_KEY',
  },
  settingsDetail: 'validate per-env keys from .env.<environment>',
  instructions: [
    'Will validate STRIPE_SECRET_KEY from each .env.<environment> via the Stripe API.',
    'No resource is created — enter the keys directly in .env.<environment> (not setup credentials).',
  ],
  describe: ({ environments }) => ({ environments }),
  validate: validateStripe,
});
