/**
 * Stripe provider for `pnpm setup:infra`.
 *
 * Validates Stripe API keys per environment (test vs live mode); no resource is created.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; `.setup-state.json` is gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import type { InfraProviderContext, ProviderResult } from '@tooling/setup/common/types.js';
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
  const stripe = context.secrets.stripe;
  if (!stripe || Object.keys(stripe).length === 0) {
    return { success: true, message: 'Stripe: skipped (no keys configured)' };
  }

  let allValid = true;
  for (const environmentName of context.environments) {
    const secretKey = stripe[environmentName]?.secretKey;
    if (!secretKey) {
      logger.warn(`  Stripe key for "${environmentName}" — not configured`);
      continue;
    }
    if (!(await validateStripeKey(secretKey, environmentName))) allValid = false;
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
    detail: 'Secret key per env (development/production)',
    url: 'https://dashboard.stripe.com/test/apikeys',
    configKey: 'stripe.<env>.secretKey',
  },
  settingsDetail: 'validate per-env keys',
  instructions: [
    'Will validate Stripe secret keys per environment via the Stripe API.',
    'No resource is created — keys come from the Stripe Dashboard.',
  ],
  describe: ({ environments }) => ({ environments }),
  validate: validateStripe,
});
